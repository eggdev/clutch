import { expect, test } from 'bun:test';

import { Sessions } from '@repo/sync/service/sessions';
import { DatabaseTest } from '@repo/sync/testing/database';
import { SyncRpcs } from '@repo/sync/types/protocol';
import { Context, Deferred, Effect, Fiber, Layer, Stream } from 'effect';
import { RpcClient } from 'effect/rpc';

import { apiProcess, deltasOnly, socketClient, syncUrl } from '@/test/socket';

const at = '2026-10-28T12:00:00.000Z';

/** Two processes of the API over one database, each with its own HTTP server and wake. */
const twoProcesses = Effect.gen(function* () {
  const first = yield* Layer.build(apiProcess());
  const second = yield* Layer.build(apiProcess());
  return { first, second };
});

test('a client of one API process gets the live delta of a commit on another', async () => {
  const transactionIds = await Effect.runPromise(
    Effect.gen(function* () {
      const { first, second } = yield* twoProcesses;
      const firstUrl = yield* syncUrl.pipe(Effect.provideContext(first));
      const secondUrl = yield* syncUrl.pipe(Effect.provideContext(second));
      return yield* Effect.gen(function* () {
        const rpc = yield* RpcClient.make(SyncRpcs);
        const connected = yield* Deferred.make<boolean>();
        const reading = yield* rpc.Pull({ lastSyncId: 0, groups: ['space:general'] }).pipe(
          Stream.tap(() => Deferred.succeed(connected, true)),
          Stream.flatMap((message) => Stream.fromIterable(deltasOnly(message))),
          Stream.filter((delta) => delta.transactionId?.startsWith('t-') ?? false),
          Stream.take(2),
          Stream.runCollect,
          Effect.forkChild,
        );
        yield* Deferred.await(connected);
        // Both notes go through the first process. The client is on the second.
        yield* Effect.flatMap(RpcClient.make(SyncRpcs), (writer) =>
          writer.Push({
            transactions: ['n1', 'n2'].map((id) => ({
              id: `t-${id}`,
              command: 'notes/create',
              input: { id, spaceId: 'general', title: id, at },
            })),
          }),
        ).pipe(Effect.scoped, Effect.provide(socketClient(firstUrl)));
        const deltas = yield* Fiber.join(reading).pipe(Effect.timeout('5 seconds'));
        return deltas.map((delta) => delta.transactionId);
      }).pipe(Effect.scoped, Effect.provide(socketClient(secondUrl)));
    }).pipe(Effect.scoped, Effect.provide(DatabaseTest())),
  );
  expect(transactionIds).toEqual(['t-n1', 't-n2']);
}, 30_000);

test('a sign-out on one API process closes the socket of the user on another', async () => {
  const result = await Effect.runPromise(
    Effect.gen(function* () {
      const { first, second } = yield* twoProcesses;
      const secondUrl = yield* syncUrl.pipe(Effect.provideContext(second));
      const socket = new WebSocket(secondUrl);
      const closed = Effect.callback<number>((resume) => {
        socket.addEventListener('close', (event) => resume(Effect.succeed(event.code)));
      });
      yield* Effect.callback<true>((resume) => {
        socket.addEventListener('open', () => resume(Effect.succeed(true)));
      });
      const ended = yield* Context.get(first, Sessions).end('user-test');
      return { ended, code: yield* closed.pipe(Effect.timeout('5 seconds')) };
    }).pipe(Effect.scoped, Effect.provide(DatabaseTest())),
  );
  // The first process holds no socket of the user. The second closes its socket with 4401.
  expect(result).toEqual({ ended: 0, code: 4401 });
}, 30_000);
