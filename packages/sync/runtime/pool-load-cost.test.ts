import { expect, test } from 'bun:test';

import { localChange } from '@repo/sync/contract/command';
import { createPool } from '@repo/sync/runtime/pool';
import {
  poolState,
  testCommand,
  testGroup,
  testModel,
  testStamps,
} from '@repo/sync/testing/pool-state';

/**
 * A load and a large delta cost work in proportion to the records that they
 * change. The `compared` count of the pool says that each change puts each
 * record in step once. The growth of the cost from `small` to 16 times as
 * many records then shows whether each record costs a fixed amount: a fixed
 * cost grows about 16 to 30 times, with the sort of an ID list, and a copy of
 * a growing list for each record grows about 256 times. The test compares two
 * costs of the same run, so the speed of the machine cancels out.
 */

const card = testModel('Card', { id: 'string', title: 'string' });
const rename = testCommand('cards/rename', { id: 'string', title: 'string' }, 'local');
const renameLocal = localChange(rename, (draft, input) => {
  draft.put(card, input);
});

const small = 2000;
const large = small * 16;

const rowsOf = (count: number) =>
  Array.from({ length: count }, (_, index) => ({ id: `c${index}`, title: `Card ${index}` }));

function countedPool(steps: Array<number>) {
  return createPool(
    [renameLocal],
    { records: [card], commands: [rename] },
    { stamps: testStamps(), compared: (records) => steps.push(records) },
  );
}

/** The shortest of 5 runs of `work`, each on a fresh setup. */
function cost(setup: () => () => void): number {
  const times: Array<number> = [];
  for (let run = 0; run < 5; run += 1) {
    const work = setup();
    const start = performance.now();
    work();
    times.push(performance.now() - start);
  }
  return Math.min(...times);
}

function loadOf(count: number, steps: Array<number> = []) {
  const rows = rowsOf(count);
  return () => {
    const pool = countedPool(steps);
    return () => pool.load(poolState({ lastSyncId: 1, tables: { Card: rows } }));
  };
}

function deltaOf(count: number, steps: Array<number> = []) {
  const rows = rowsOf(count);
  const changes = rows.map((row) => ({
    model: 'Card',
    id: row.id,
    action: 'upsert' as const,
    data: { title: `New ${row.id}` },
    groups: [testGroup],
  }));
  return () => {
    const pool = countedPool(steps);
    pool.load(poolState({ lastSyncId: 1, tables: { Card: rows } }));
    pool.ids(card, { by: 'title', direction: 'asc' });
    steps.length = 0;
    return () => pool.applyDeltas([{ syncId: 2, transactionId: null, changes }]);
  };
}

test('a load puts each record in step once, and its cost grows with the records', () => {
  const steps: Array<number> = [];
  loadOf(small, steps)()();
  expect(steps).toEqual([small]);
  cost(loadOf(small));
  expect(cost(loadOf(large)) / cost(loadOf(small))).toBeLessThan(48);
});

test('a delta of every record puts each one in step once, and its cost grows with the records', () => {
  const steps: Array<number> = [];
  deltaOf(small, steps)()();
  expect(steps).toEqual([small]);
  cost(deltaOf(small));
  expect(cost(deltaOf(large)) / cost(deltaOf(small))).toBeLessThan(48);
});
