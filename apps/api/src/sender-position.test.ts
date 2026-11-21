import { expect, test } from 'bun:test';

import { createNote } from '@repo/notes/contract/notes';
import { notesClient } from '@repo/notes/runtime/client';
import { createPool } from '@repo/sync/runtime/pool';
import { engine } from '@repo/sync/runtime/transport';
import { SyncRpcs } from '@repo/sync/types/protocol';
import { Effect, Schedule } from 'effect';
import { RpcClient } from 'effect/rpc';

import { socketClient, syncUrl, testServer } from '@/test/socket';

function sessionStays() {
  // The session does not end in this test.
}

test('a transaction into a group that the client did not load stops waiting', async () => {
  const pool = createPool(notesClient.localChanges, notesClient.contract);
  // The client loads only its eager groups, so it sees no note of the space.
  pool.run(createNote, {
    id: 'n1',
    spaceId: 'general',
    title: 'n1',
    at: '2026-10-28T12:00:00.000Z',
  });
  const settled = Effect.sync(() => pool.snapshot().pending.length === 0).pipe(
    Effect.repeat({ until: (done) => done, schedule: Schedule.spaced('20 millis') }),
    Effect.as('settled'),
  );
  const result = await Effect.runPromise(
    Effect.gen(function* () {
      const url = yield* syncUrl;
      return yield* Effect.gen(function* () {
        const client = yield* RpcClient.make(SyncRpcs);
        yield* Effect.forkScoped(engine(pool, client, 'digest', sessionStays));
        return yield* Effect.raceFirst(settled, Effect.as(Effect.sleep('5 seconds'), 'waiting'));
      }).pipe(Effect.scoped, Effect.provide(socketClient(url)));
    }).pipe(Effect.provide(testServer)),
  );
  expect(pool.loadedGroups()).not.toContain('space:general');
  expect(result).toBe('settled');
  expect(pool.lastSyncId()).toBeGreaterThan(0);
}, 30_000);

test('a transaction accepted while no pull heard of it stops waiting on the next connection', async () => {
  const pool = createPool(notesClient.localChanges, notesClient.contract);
  const result = await Effect.runPromise(
    Effect.gen(function* () {
      const url = yield* syncUrl;
      // On the first connection, a first write settles, so the client holds
      // a sync ID past 0. Then its socket closes.
      pool.run(createNote, {
        id: 'n0',
        spaceId: 'general',
        title: 'n0',
        at: '2026-10-28T12:00:00.000Z',
      });
      yield* Effect.gen(function* () {
        const client = yield* RpcClient.make(SyncRpcs);
        yield* Effect.forkScoped(engine(pool, client, 'digest', sessionStays));
        yield* Effect.sync(() => pool.snapshot().pending.length === 0).pipe(
          Effect.repeat({ until: (done) => done, schedule: Schedule.spaced('20 millis') }),
        );
      }).pipe(Effect.scoped, Effect.provide(socketClient(url)));
      const before = pool.lastSyncId();
      // The push goes on a socket with no pull, so no pull hears that the
      // server accepted it, as when the socket drops right after the push.
      // The transaction writes only to a group that the client did not load.
      pool.run(createNote, {
        id: 'n1',
        spaceId: 'general',
        title: 'n1',
        at: '2026-10-28T12:00:00.000Z',
      });
      const outcomes = yield* Effect.gen(function* () {
        const client = yield* RpcClient.make(SyncRpcs);
        const batch = pool.unsent();
        pool.markSent(
          batch.map((transaction) => transaction.id),
          true,
        );
        return yield* client.Push({ transactions: batch });
      }).pipe(Effect.scoped, Effect.provide(socketClient(url)));
      pool.settle(outcomes);
      const waitingAfterPush = pool.snapshot().pending.length;
      // The next connection pulls from the old position. No event of its
      // groups follows it, so only the delta at the head moves it past the write.
      const settled = Effect.sync(() => pool.snapshot().pending.length === 0).pipe(
        Effect.repeat({ until: (done) => done, schedule: Schedule.spaced('20 millis') }),
        Effect.as('settled'),
      );
      const end = yield* Effect.gen(function* () {
        const client = yield* RpcClient.make(SyncRpcs);
        yield* Effect.forkScoped(engine(pool, client, 'digest', sessionStays));
        return yield* Effect.raceFirst(settled, Effect.as(Effect.sleep('5 seconds'), 'waiting'));
      }).pipe(Effect.scoped, Effect.provide(socketClient(url)));
      return { before, outcomes, waitingAfterPush, end };
    }).pipe(Effect.provide(testServer)),
  );
  expect(result.outcomes).toMatchObject([{ status: 'accepted' }]);
  const accepted = result.outcomes[0]?.syncId ?? 0;
  expect(result.before).toBeGreaterThan(0);
  expect(accepted).toBeGreaterThan(result.before);
  expect(result.waitingAfterPush).toBe(1);
  expect(result.end).toBe('settled');
  expect(pool.loadedGroups()).not.toContain('space:general');
  expect(pool.lastSyncId()).toBe(accepted);
}, 30_000);
