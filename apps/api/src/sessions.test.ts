import { expect, test } from 'bun:test';

import { Actors } from '@repo/identity/service/actors';
import { testActor } from '@repo/identity/testing/actor';
import { SyncRpcs } from '@repo/sync/types/protocol';
import { SessionEnded } from '@repo/sync/types/session-ended';
import { Deferred, Effect, Exit, Layer, Option, Stream } from 'effect';
import { RpcClient } from 'effect/rpc';
import type { RpcClientError } from 'effect/rpc/RpcClientError';

import {
  socketClient,
  syncUrl,
  testServer,
  testServerWith,
  watchedSocketClient,
} from '@/test/socket';

/**
 * The end of a session over a real socket. The server names the actor of
 * each pull, and it closes the socket of a connection with no session with
 * code 4401, so a client that was offline when its session ended learns it
 * when it connects. A session that ends while the socket is open closes the
 * socket the same way, at the next call.
 */

/** The close code of one socket to the sync path, or `open` when it stays open for a while. */
function closeCode(url: string) {
  return Effect.callback<number | 'open'>((resume) => {
    const socket = new WebSocket(url);
    const timer = setTimeout(() => {
      socket.close();
      resume(Effect.succeed('open'));
    }, 1000);
    socket.addEventListener('close', (event) => {
      clearTimeout(timer);
      resume(Effect.succeed(event.code));
    });
  });
}

test('the first Groups message of a pull names the actor of the connection', async () => {
  const messages = await Effect.runPromise(
    Effect.gen(function* () {
      const url = yield* syncUrl;
      return yield* Effect.gen(function* () {
        const rpc = yield* RpcClient.make(SyncRpcs);
        return yield* rpc
          .Pull({ lastSyncId: 0, groups: [] })
          .pipe(Stream.take(1), Stream.runCollect);
      }).pipe(Effect.scoped, Effect.provide(socketClient(url)));
    }).pipe(Effect.provide(testServer)),
  );
  expect(messages[0]).toMatchObject({
    _tag: 'Groups',
    actor: { userId: 'user-test', organizationId: 'org-test' },
  });
});

test('a socket with no session opens and closes at once with code 4401', async () => {
  const noSession = Layer.succeed(Actors)({
    fromHeaders: () => Effect.die(new SessionEnded({ code: 4401 })),
  });
  const code = await Effect.runPromise(
    Effect.gen(function* () {
      return yield* closeCode(yield* syncUrl);
    }).pipe(Effect.provide(testServerWith(noSession))),
  );
  expect(code).toBe(4401);
});

test('another failure of the actors is a server fault, not an ended session', async () => {
  const broken = Layer.succeed(Actors)({
    fromHeaders: () => Effect.die(new Error('The sign-in vendor did not answer.')),
  });
  const code = await Effect.runPromise(
    Effect.gen(function* () {
      return yield* closeCode(yield* syncUrl);
    }).pipe(Effect.provide(testServerWith(broken))),
  );
  expect(code).not.toBe(4401);
});

/** Actors that name the test actor at the upgrade of the socket, and die with `defect` at each call after it. */
function namedThenGone(defect: unknown) {
  let calls = 0;
  return Layer.succeed(Actors)({
    fromHeaders: () => {
      calls += 1;
      return calls === 1 ? Effect.succeed(testActor) : Effect.die(defect);
    },
  });
}

const ended = new SessionEnded({ code: 4401 });

/** A client of the sync calls over a socket. */
type SyncClient = RpcClient.FromGroup<typeof SyncRpcs, RpcClientError>;

/** One call of each kind, on a socket whose upgrade named an actor. */
const calls = {
  Pull: (rpc: SyncClient) => rpc.Pull({ lastSyncId: 0, groups: [] }).pipe(Stream.runDrain),
  Push: (rpc: SyncClient) =>
    rpc.Push({ transactions: [{ id: 't1', command: 'notes.create', input: {} }] }),
  Load: (rpc: SyncClient) => rpc.Load({ group: 'org:org-test' }),
};

for (const [name, call] of Object.entries(calls)) {
  test(`a ${name} whose session ended while the socket was open closes the socket with code 4401`, async () => {
    const code = await Effect.runPromise(
      Effect.gen(function* () {
        const { client, code: closed } = yield* watchedSocketClient(yield* syncUrl);
        return yield* Effect.gen(function* () {
          const rpc = yield* RpcClient.make(SyncRpcs);
          yield* call(rpc).pipe(Effect.ignoreCause, Effect.forkScoped);
          return yield* Deferred.await(closed);
        }).pipe(Effect.scoped, Effect.provide(client));
      }).pipe(Effect.provide(testServerWith(namedThenGone(ended)))),
    );
    expect(code).toBe(4401);
  });
}

test('another defect of the actors on an open socket is a server fault, and the socket stays open', async () => {
  const result = await Effect.runPromise(
    Effect.gen(function* () {
      const { client, code: closed } = yield* watchedSocketClient(yield* syncUrl);
      return yield* Effect.gen(function* () {
        const rpc = yield* RpcClient.make(SyncRpcs);
        // Both calls get their answer over the socket, so it did not close.
        const pull = yield* calls.Pull(rpc).pipe(Effect.exit);
        const push = yield* calls.Push(rpc).pipe(Effect.exit);
        return { pull, push, closed: yield* Deferred.poll(closed) };
      }).pipe(Effect.scoped, Effect.provide(client));
    }).pipe(
      Effect.provide(
        testServerWith(namedThenGone(new Error('The sign-in vendor did not answer.'))),
      ),
    ),
  );
  expect(Exit.isFailure(result.pull)).toBe(true);
  expect(Exit.isFailure(result.push)).toBe(true);
  expect(Option.isNone(result.closed)).toBe(true);
});
