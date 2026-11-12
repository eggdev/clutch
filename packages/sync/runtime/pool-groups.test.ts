import { expect, test } from 'bun:test';

import { defineGroup } from '@repo/sync/contract/groups';
import { record } from '@repo/sync/contract/record';
import { createPool } from '@repo/sync/runtime/pool';
import { memoryLocalDatabase } from '@repo/sync/testing/local-database';
import type { Change } from '@repo/sync/types/protocol';

const card = record('Card', {
  fields: { id: 'string', title: 'string', space: 'string' },
  groups: [defineGroup('space').by('space')],
});
const declared = { records: [card], commands: [] };

const put = (id: string, groups: ReadonlyArray<string>, title = id): Change => ({
  model: 'Card',
  id,
  action: 'upsert',
  data: { title, space: groups[0]?.replace('space:', '') ?? '' },
  groups,
});

function loadedPool() {
  const pool = createPool([], declared);
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
  const saves: Array<Promise<void>> = [];
  pool.onChange(() => {
    saves.push(database.write(pool.snapshot()));
  });
  pool.applyGroups(['org:a'], []);
  // Wait for the save that the purge started, not for a guessed tick.
  expect(saves.length).toBeGreaterThan(0);
  await Promise.all(saves);
  const saved = await database.read();
  expect(saved?.tables.Card).toEqual([]);
  expect(Object.keys(saved?.meta ?? {})).toEqual([]);
});

test('a backfill adds the past records of a new group, and never undoes a later change', () => {
  const pool = createPool([], declared);
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
  const pool = createPool([], declared);
  pool.applyGroups(['org:a'], []);
  const asked: Array<string> = [];
  pool.onLoadRequest((group) => asked.push(group));
  let done = false;
  const waiting = pool.loadGroup('space:x').then(() => {
    done = true;
  });
  // setImmediate runs after every pending promise callback, so a gate that
  // resolved on its own would have set done by then.
  await new Promise((resolve) => {
    setImmediate(resolve);
  });
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
  expect(await pool.loadGroup('space:x')).toBe(true);
});

test('a refused group ends each gate that waits for it, and the engine does not ask again', async () => {
  const lines: Array<string> = [];
  const pool = createPool([], declared, { report: (line) => lines.push(line) });
  const gates = [pool.loadGroup('space:x'), pool.loadGroup('space:x')];
  pool.refuseGroup('space:x');
  expect(await Promise.all(gates)).toEqual([false, false]);
  expect(pool.requestedGroups()).toEqual([]);
  expect(lines).toHaveLength(1);
});

test('a saved copy that names no group for its records is dropped, and the pool says so', () => {
  const lines: Array<string> = [];
  const pool = createPool([], declared, { report: (line) => lines.push(line) });
  pool.load({ lastSyncId: 9, tables: { Card: [] }, pending: [] } as never);
  expect(pool.lastSyncId()).toBe(0);
  expect(lines).toEqual([
    'The saved copy names no group for its records, so this build cannot read it. Its records were dropped, and the pool loads again from the server.',
  ]);
});
