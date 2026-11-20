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
