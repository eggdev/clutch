import { expect, test } from 'bun:test';

import { localChange } from '@repo/sync/contract/command';
import { createPool } from '@repo/sync/runtime/pool';
import { poolState, testCommand, testModel, testStamps } from '@repo/sync/testing/pool-state';
import type { Change } from '@repo/sync/types/protocol';

/**
 * A sorted ID list follows what changed. After a change to a few records of
 * a model, the list takes out the changed IDs and puts back the ones that
 * still match its filter, at their place by the sort key. It does not sort
 * the model again. Each saved record is a proxy that notes when the pool
 * reads it, as in `pool-change-cost.test.ts`, so a full sort shows.
 */

const card = testModel('Card', { id: 'string', title: 'string', list: 'string' });
const rename = testCommand('cards/rename', { id: 'string', title: 'string' }, 'local');
const renameLocal = localChange(rename, (draft, input) => {
  const current = draft.get(card, input.id);
  if (current) {
    draft.put(card, { ...current, title: input.title });
  }
});

const byTitle = { by: 'title', direction: 'asc' } as const;
const byTitleDown = { by: 'title', direction: 'desc' } as const;
const inListA = { field: 'list', equals: 'a' } as const;

/** The IDs of the saved records that the pool read since the last `read.clear()`. */
const read = new Set<string>();

type Row = { readonly id: string; readonly title: string; readonly list: string };

/** A saved card that notes each read of it. */
function watched(row: Row): Row {
  return new Proxy(row, {
    get(target, key, receiver) {
      read.add(row.id);
      return Reflect.get(target, key, receiver);
    },
  });
}

const upsert = (row: Row): Change => ({
  model: 'Card',
  id: row.id,
  action: 'upsert',
  data: { title: row.title, list: row.list },
  groups: ['org:test'],
});

const remove = (id: string): Change => ({
  model: 'Card',
  id,
  action: 'delete',
  data: null,
  groups: ['org:test'],
});

/** The IDs of `rows` that match `list`, sorted as the pool sorts them, as a plain reference. */
function reference(rows: Iterable<Row>, direction: 'asc' | 'desc', list?: string): Array<string> {
  const sign = direction === 'desc' ? -1 : 1;
  return [...rows]
    .filter((row) => list === undefined || row.list === list)
    .toSorted((a, b) => sign * a.title.localeCompare(b.title) || a.id.localeCompare(b.id))
    .map((row) => row.id);
}

/** A pool that holds `rows`. */
function poolOf(rows: ReadonlyArray<Row>) {
  const pool = createPool(
    [renameLocal],
    { records: [card], commands: [rename] },
    {
      stamps: testStamps(),
    },
  );
  pool.load(poolState({ lastSyncId: 1, tables: { Card: rows.map(watched) } }));
  return pool;
}

test('a change of 3 records in a model of many places them in the sorted list, and sorts nothing again', () => {
  const count = 10_000;
  const rows = Array.from({ length: count }, (_, index) => ({
    id: `c${index}`,
    title: `Title ${(index * 7919) % count}`,
    list: index % 2 ? 'a' : 'b',
  }));
  const pool = poolOf(rows);
  expect(pool.ids(card, byTitle)).toEqual(reference(rows, 'asc'));
  const filtered = pool.ids(card, byTitle, inListA);
  const changed = [
    { id: 'c10', title: 'Title 0000', list: 'b' },
    { id: 'c12', title: 'Title zzz', list: 'b' },
    { id: 'c14', title: 'Title 5', list: 'b' },
  ];
  read.clear();
  pool.applyDeltas([{ syncId: 2, transactionId: null, changes: changed.map(upsert) }]);
  const ids = pool.ids(card, byTitle);
  // Each changed record goes back by a binary search, which reads about log2(n) records.
  expect(read.size).toBeLessThanOrEqual(changed.length * (Math.ceil(Math.log2(count)) + 2));
  const now = new Map(rows.map((row) => [row.id, row]));
  for (const row of changed) {
    now.set(row.id, row);
  }
  expect(ids).toEqual(reference(now.values(), 'asc'));
  // The changed records were in list b and stay there, so list a keeps its array.
  expect(pool.ids(card, byTitle, inListA)).toBe(filtered);
});

/** Random numbers from a seed, so a failure repeats. */
function seeded(seed: number) {
  let state = seed;
  return (below: number) => {
    state = (state * 1_103_515_245 + 12_345) % 2_147_483_648;
    return state % below;
  };
}

test('after random changes, each sorted list equals a full sort of the records', () => {
  const random = seeded(42);
  const titles = ['Apple', 'apple', 'Banana', 'Cherry', 'Date', 'Elder', 'Fig', 'Grape'];
  const rowOf = (index: number): Row => ({
    id: `c${index}`,
    title: titles[random(titles.length)] ?? 'Apple',
    list: random(2) ? 'a' : 'b',
  });
  const rows = Array.from({ length: 300 }, (_, index) => rowOf(index));
  // The model of the test: the confirmed rows, and the title of the last
  // waiting rename of each ID, which writes over its confirmed row.
  const confirmed = new Map(rows.map((row) => [row.id, row]));
  const renamed = new Map<string, string>();
  const pool = poolOf(rows);
  let syncId = 1;
  for (let step = 0; step < 200; step += 1) {
    const changes: Array<Change> = [];
    for (let count = 1 + random(4); count > 0; count -= 1) {
      const index = random(360);
      const id = `c${index}`;
      const kind = random(5);
      if (kind === 0 && confirmed.has(id)) {
        changes.push(remove(id));
        confirmed.delete(id);
      } else if (kind === 1 && confirmed.has(id)) {
        const title = titles[random(titles.length)] ?? 'Apple';
        pool.run(rename, { id, title });
        renamed.set(id, title);
      } else {
        const row = rowOf(index);
        changes.push(upsert(row));
        confirmed.set(id, row);
      }
    }
    syncId += 1;
    pool.applyDeltas([{ syncId, transactionId: null, changes }]);
    const now = [...confirmed.values()].map((row) => ({
      ...row,
      title: renamed.get(row.id) ?? row.title,
    }));
    expect(pool.ids(card, byTitle)).toEqual(reference(now, 'asc'));
    expect(pool.ids(card, byTitleDown)).toEqual(reference(now, 'desc'));
    expect(pool.ids(card, byTitle, inListA)).toEqual(reference(now, 'asc', 'a'));
  }
});
