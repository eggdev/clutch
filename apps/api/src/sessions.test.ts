import { expect, test } from 'bun:test';

import { Actors } from '@repo/identity/service/actors';
import { SyncRpcs } from '@repo/sync/types/protocol';
import { SessionEnded } from '@repo/sync/types/session-ended';
import { Effect, Layer, Stream } from 'effect';
import { RpcClient } from 'effect/rpc';

import { socketClient, syncUrl, testServer, testServerWith } from '@/test/socket';

/**
 * The end of a session over a real socket. The server names the actor of
 * each pull, and it closes the socket of a connection with no session with
 * code 4401, so a client that was offline when its session ended learns it
 * when it connects.
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
