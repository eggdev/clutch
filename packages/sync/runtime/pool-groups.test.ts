import { expect, test } from 'bun:test';

import { defineModel } from '@repo/sync/models/define';
import { createPool } from '@repo/sync/runtime/pool';
import { memoryLocalDatabase } from '@repo/sync/testing/local-database';
import type { Change } from '@repo/sync/types/protocol';

type Card = { readonly id: string; readonly title: string; readonly space: string };
const card = defineModel<Card>('Card', { groupsOf: (row) => [`space:${row.space}`] });

const put = (id: string, groups: ReadonlyArray<string>, title = id): Change => ({
  model: 'Card',
  id,
  action: 'upsert',
  data: { title },
  groups,
});

function loadedPool() {
  const pool = createPool([]);
  pool.applyGroups(['org:a', 'space:x', 'space:y'], []);
  pool.applyDeltas([
    {
      syncId: 1,
      transactionId: null,
      changes: [put('a', ['space:x']), put('b', ['space:y']), put('both', ['space:x', 'space:y'])],
    },
  ]);
  return pool;
}

test('losing a group deletes its records, and a record still in another group stays', () => {
  const pool = loadedPool();
  pool.applyGroups(['org:a', 'space:y'], []);
  expect(pool.ids(card).toSorted()).toEqual(['b', 'both']);
  expect(pool.loadedGroups().toSorted()).toEqual(['org:a', 'space:y']);
});

test('the purge reaches the local database through the next save', async () => {
  const pool = loadedPool();
  const database = memoryLocalDatabase();
  pool.onChange(() => {
    void database.write(pool.snapshot());
  });
  pool.applyGroups(['org:a'], []);
  await Bun.sleep(0);
  const saved = await database.read();
  expect(saved?.tables.Card).toEqual([]);
  expect(Object.keys(saved?.meta ?? {})).toEqual([]);
});

test('a backfill adds the past records of a new group, and never undoes a later change', () => {
  const pool = createPool([]);
  pool.applyGroups(['org:a', 'space:x'], []);
  pool.applyDeltas([
    { syncId: 5, transactionId: null, changes: [put('both', ['space:x', 'space:y'], 'New')] },
  ]);
  pool.applyGroups(
    ['org:a', 'space:x', 'space:y'],
    [
      { syncId: 2, transactionId: null, changes: [put('old', ['space:y'])] },
      { syncId: 3, transactionId: null, changes: [put('both', ['space:x', 'space:y'], 'Old')] },
    ],
  );
  expect(pool.get(card, 'old')?.title).toBe('old');
  expect(pool.get(card, 'both')?.title).toBe('New');
  expect(pool.lastSyncId()).toBe(5);
});

test('a gate waits for a group until the engine loads it, and a loaded group resolves at once', async () => {
  const pool = createPool([]);
  pool.applyGroups(['org:a'], []);
  const asked: Array<string> = [];
  pool.onLoadRequest((group) => asked.push(group));
  let done = false;
  const waiting = pool.loadGroup('space:x').then(() => {
    done = true;
  });
  await Bun.sleep(0);
  expect(done).toBe(false);
  expect(asked).toEqual(['space:x']);
  expect(pool.requestedGroups()).toEqual(['space:x']);
  pool.applyGroups(
    ['org:a', 'space:x'],
    [{ syncId: 1, transactionId: null, changes: [put('a', ['space:x'])] }],
  );
  await waiting;
  expect(pool.get(card, 'a')).toBeDefined();
  expect(pool.requestedGroups()).toEqual([]);
  await pool.loadGroup('space:x');
});

test('a state saved before records had groups loads as an empty pool', () => {
  const pool = createPool([]);
  pool.load({ lastSyncId: 9, tables: { Card: [] }, pending: [] } as never);
  expect(pool.lastSyncId()).toBe(0);
});
