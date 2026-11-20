import { expect, test } from 'bun:test';

import { WakePglite } from '@repo/sync/runtime/wake.server';
import { Sessions } from '@repo/sync/service/sessions';
import { Wake } from '@repo/sync/service/wake';
import { DatabaseTest } from '@repo/sync/testing/database';
import { SyncRpcs } from '@repo/sync/types/protocol';
import { Context, Deferred, Effect, Fiber, Layer, Stream } from 'effect';
import { RpcClient } from 'effect/rpc';

import { apiProcess, deltasOnly, openSocket, socketClient, syncUrl } from '@/test/socket';

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
      const closed = yield* openSocket(secondUrl);
      const ended = yield* Context.get(first, Sessions).end('user-test');
      return { ended, code: yield* closed.pipe(Effect.timeout('5 seconds')) };
    }).pipe(Effect.scoped, Effect.provide(DatabaseTest())),
  );
  // The first process holds no socket of the user. The second closes its socket with 4401.
  expect(result).toEqual({ ended: { closed: 0, othersTold: true }, code: 4401 });
}, 30_000);

test('a sign-out whose wake cannot send closes the sockets of its process, and says the others missed it', async () => {
  let sends = 0;
  const send = () =>
    Effect.suspend(() => {
      sends += 1;
      return Effect.fail('down');
    });
  const failingSend = Layer.effect(Wake)(
    Effect.gen(function* () {
      return Wake.of({ ...(yield* Wake), send });
    }),
  ).pipe(Layer.provide(Layer.fresh(WakePglite)));
  const result = await Effect.runPromise(
    Effect.gen(function* () {
      const process = yield* Layer.build(apiProcess(failingSend));
      const closed = yield* openSocket(yield* syncUrl.pipe(Effect.provideContext(process)));
      const ended = yield* Context.get(process, Sessions).end('user-test');
      return { ended, code: yield* closed.pipe(Effect.timeout('5 seconds')) };
    }).pipe(Effect.scoped, Effect.provide(DatabaseTest())),
  );
  expect(result).toEqual({ ended: { closed: 1, othersTold: false }, code: 4401 });
  // The first send and three more tries.
  expect(sends).toBe(4);
}, 30_000);
