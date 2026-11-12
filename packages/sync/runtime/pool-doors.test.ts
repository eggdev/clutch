import { expect, test } from 'bun:test';

import { createPool } from '@repo/sync/runtime/pool';
import { declarationsByName, savedRecordsMisfit } from '@repo/sync/runtime/pool-doors';
import { poolState, testGroup, testModel, testStamps } from '@repo/sync/testing/pool-state';
import type { PoolState } from '@repo/sync/types/local-database';

const card = testModel('Card', { id: 'string', title: 'string' });
const declared = { records: [card], commands: [] };

/** A pool that keeps each sentence it reports. */
function reportingPool() {
  const lines: Array<string> = [];
  const pool = createPool([], declared, {
    stamps: testStamps(),
    report: (line) => lines.push(line),
  });
  return { pool, lines };
}

const anotherShape =
  'The saved copy has another shape than this build reads, so it was dropped, and the pool loads again from the server.';

test('a saved copy with no tables, or with a table that is no list, has another shape', () => {
  const byName = declarationsByName(declared.records);
  expect(savedRecordsMisfit({}, byName)).toBe(anotherShape);
  expect(savedRecordsMisfit(JSON.parse('{"tables":{"Card":"text"}}'), byName)).toBe(anotherShape);
  expect(savedRecordsMisfit(JSON.parse('{"tables":[]}'), byName)).toBe(anotherShape);
});

test('a saved copy with another shape is dropped and reported, and the pool still starts', () => {
  // What a device may hold after a crash, or a copy that another program wrote.
  const shapes: Array<unknown> = [{}, { tables: { Card: 'text' } }, { tables: {}, groups: 7 }];
  for (const shape of shapes) {
    const { pool, lines } = reportingPool();
    pool.load(shape as PoolState);
    expect(lines).toHaveLength(1);
    expect(pool.ids(card)).toEqual([]);
    expect(pool.lastSyncId()).toBe(0);
    expect(pool.unsent()).toEqual([]);
  }
});

test('a dropped copy that names its groups has them asked for again', () => {
  const { pool, lines } = reportingPool();
  const saved: Partial<PoolState> = { groups: [testGroup] };
  pool.load(Object.assign(poolState({ lastSyncId: 3, tables: {} }), saved, { tables: 'text' }));
  expect(lines).toEqual([anotherShape]);
  expect(pool.requestedGroups()).toEqual([testGroup]);
});

test('a record of a model that this build does not declare is not stored, so the next start keeps the rest', () => {
  const { pool, lines } = reportingPool();
  pool.load(poolState({ lastSyncId: 1, tables: { Card: [{ id: 'a', title: 'Kept' }] } }));
  pool.applyDeltas([
    {
      syncId: 2,
      transactionId: null,
      changes: [
        { model: 'Label', id: 'x', action: 'upsert', data: { name: 'Later' }, groups: [testGroup] },
      ],
    },
  ]);
  expect(lines).toEqual([
    'The server sent Label x, and this build declares no Label. This build is older than the server, so the record was not stored.',
  ]);
  // The saved copy holds no record that this build cannot check, so a cold start drops nothing.
  const next = reportingPool();
  next.pool.load(pool.snapshot());
  expect(next.lines).toEqual([]);
  expect(next.pool.get(card, 'a')?.title).toBe('Kept');
  expect(next.pool.lastSyncId()).toBe(2);
});

const leftOut =
  'Another build of this app left out a record that it could not read, so this build loads each record again from the server.';

/** The saved copy of a build, named `old`, that got a record of a model it does not declare. */
function copyWithARecordLeftOut() {
  const { pool } = reportingPool();
  pool.nameBuild('old');
  pool.load(poolState({ lastSyncId: 1, tables: { Card: [{ id: 'a', title: 'Kept' }] } }));
  pool.applyDeltas([
    {
      syncId: 2,
      transactionId: null,
      changes: [
        { model: 'Label', id: 'x', action: 'upsert', data: { name: 'Later' }, groups: [testGroup] },
      ],
    },
  ]);
  return pool.snapshot();
}

test('the next build loads a copy again from 0 when another build left a record out of it', () => {
  const saved = copyWithARecordLeftOut();
  expect(saved.leftOutBy).toBe('old');
  const { pool, lines } = reportingPool();
  pool.load(saved);
  expect(pool.lastSyncId()).toBe(2);
  pool.nameBuild('new');
  // The pull then starts at 0, so the server sends the record that the old build left out.
  expect(lines).toEqual([leftOut]);
  expect(pool.lastSyncId()).toBe(0);
  expect(pool.ids(card)).toEqual([]);
  expect(pool.loadedGroups()).toEqual([testGroup]);
  expect(pool.snapshot().leftOutBy).toBeUndefined();
});

test('the build that left the record out keeps its copy, since it still cannot read the record', () => {
  const { pool, lines } = reportingPool();
  pool.load(copyWithARecordLeftOut());
  pool.nameBuild('old');
  expect(lines).toEqual([]);
  expect(pool.lastSyncId()).toBe(2);
  expect(pool.get(card, 'a')?.title).toBe('Kept');
});
