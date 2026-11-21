import { expect, test } from 'bun:test';

import { localChange } from '@repo/sync/contract/command';
import { createPool } from '@repo/sync/runtime/pool';
import { poolState, testCommand, testModel, testStamps } from '@repo/sync/testing/pool-state';
import type { Change } from '@repo/sync/types/protocol';

/**
 * The cost of a change follows what changed, not what the pool holds. The
 * pool says how many records each change put in step with `compared`. Each
 * saved record is also a proxy that notes when the pool reads it, so a change
 * that compares or checks a record that it did not change fails.
 */

const card = testModel('Card', { id: 'string', title: 'string' });
const rename = testCommand('cards/rename', { id: 'string', title: 'string' }, 'local');
const renameLocal = localChange(rename, (draft, input) => {
  const current = draft.get(card, input.id);
  if (current) {
    draft.put(card, { ...current, title: input.title });
  }
});

const count = 10_000;
/** The IDs of the saved records that the pool read since the last `read.clear()`. */
const read = new Set<string>();

/** A saved card that notes each read of it. */
function watchedCard(id: string) {
  const row = { id, title: `Card ${id}` };
  return new Proxy(row, {
    get(target, key, receiver) {
      read.add(id);
      return Reflect.get(target, key, receiver);
    },
    ownKeys(target) {
      read.add(id);
      return Reflect.ownKeys(target);
    },
  });
}

/** The number of records that each change of the pool put in step, since the last `steps.length = 0`. */
const steps: Array<number> = [];

/** A pool of `count` saved cards, with two waiting renames of c1 and c2. */
function heldPool() {
  const pool = createPool(
    [renameLocal],
    { records: [card], commands: [rename] },
    { stamps: testStamps(), compared: (records) => steps.push(records) },
  );
  pool.load(
    poolState({
      lastSyncId: 1,
      tables: { Card: Array.from({ length: count }, (_, index) => watchedCard(`c${index}`)) },
    }),
  );
  pool.run(rename, { id: 'c1', title: 'Waiting one' });
  pool.run(rename, { id: 'c2', title: 'Waiting two' });
  read.clear();
  steps.length = 0;
  return pool;
}

const upsert = (id: string): Change => ({
  model: 'Card',
  id,
  action: 'upsert',
  data: { title: `Delta ${id}` },
  groups: ['org:test'],
});

test('a delta of 3 records reads only those records and the records of the waiting changes', () => {
  const pool = heldPool();
  pool.applyDeltas([
    { syncId: 2, transactionId: null, changes: [upsert('c10'), upsert('c11'), upsert('c12')] },
  ]);
  // The 3 records of the delta, and the 2 records of the waiting changes.
  expect(steps).toEqual([5]);
  expect([...read].toSorted()).toEqual(['c1', 'c10', 'c11', 'c12', 'c2']);
  expect(pool.get(card, 'c11')?.title).toBe('Delta c11');
  expect(pool.get(card, 'c1')?.title).toBe('Waiting one');
});

test('a local edit and its rejection read only the edited record and the waiting ones', () => {
  const pool = heldPool();
  const id = pool.run(rename, { id: 'c50', title: 'Edited' });
  expect(pool.get(card, 'c50')?.title).toBe('Edited');
  pool.settle([{ transactionId: id, status: 'rejected', syncId: null, reason: 'No', code: 'no' }]);
  expect(pool.get(card, 'c50')?.title).toBe('Card c50');
  expect(steps).toEqual([3, 3]);
  expect([...read].toSorted()).toEqual(['c1', 'c2', 'c50']);
});
