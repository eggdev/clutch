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

const card = testModel('Card', { id: 'string', title: 'string' });
const tag = testModel('Tag', { id: 'string', label: 'string' });
const rename = testCommand('cards/rename', { id: 'string', title: 'string' }, 'local');
const renameLocal = localChange(rename, (draft, input) => {
  const current = draft.get(card, input.id);
  if (current) {
    draft.put(card, { ...current, title: input.title });
  }
});
const archive = testCommand('cards/archive', { id: 'string' }, 'server');
const add = testCommand('cards/add', { id: 'new-id', title: 'string', at: 'now' }, 'local');
const addLocal = localChange(add, (draft, input) =>
  draft.put(card, { id: input.id, title: `${input.title} at ${input.at}` }),
);
const declared = { records: [card, tag], commands: [rename, add, archive] };

function warmPool() {
  const pool = createPool([renameLocal, addLocal], declared, { stamps: testStamps() });
  pool.load(poolState({ lastSyncId: 3, tables: { Card: [{ id: 'a', title: 'Old' }] } }));
  return pool;
}

test('a local change shows at once, and a server-waiting command does not', () => {
  const pool = warmPool();
  pool.run(rename, { id: 'a', title: 'New' });
  const archiving = pool.run(archive, { id: 'a' });
  expect(pool.get(card, 'a')?.title).toBe('New');
  expect(pool.isPending(archiving)).toBe(true);
  expect(pool.unsent().map((transaction) => transaction.command)).toEqual([
    'cards/rename',
    'cards/archive',
  ]);
});

test('a delta from another client rebases the pending change on top', () => {
  const pool = warmPool();
  const id = pool.run(rename, { id: 'a', title: 'Mine' });
  pool.applyDeltas([
    {
      syncId: 4,
      transactionId: 'other',
      changes: [
        {
          model: 'Card',
          id: 'b',
          action: 'upsert',
          data: { title: 'Theirs' },
          groups: [testGroup],
        },
      ],
    },
  ]);
  expect(pool.get(card, 'a')?.title).toBe('Mine');
  expect(pool.get(card, 'b')?.title).toBe('Theirs');
  expect(pool.isPending(id)).toBe(true);
  pool.applyDeltas([
    {
      syncId: 5,
      transactionId: id,
      changes: [
        { model: 'Card', id: 'a', action: 'upsert', data: { title: 'Mine' }, groups: [testGroup] },
      ],
    },
  ]);
  expect(pool.isPending(id)).toBe(false);
  expect(pool.lastSyncId()).toBe(5);
});

test('a delta at or below the last sync ID changes nothing', () => {
  const pool = warmPool();
  pool.applyDeltas([
    {
      syncId: 3,
      transactionId: null,
      changes: [{ model: 'Card', id: 'a', action: 'delete', data: null, groups: [testGroup] }],
    },
  ]);
  expect(pool.get(card, 'a')?.title).toBe('Old');
});

test('a rejected transaction rolls back its local change and keeps the reason', () => {
  const pool = warmPool();
  const id = pool.run(rename, { id: 'a', title: 'Nope' });
  pool.settle([
    { transactionId: id, status: 'rejected', syncId: null, reason: 'Locked', code: 'locked' },
  ]);
  expect(pool.get(card, 'a')?.title).toBe('Old');
  expect(pool.lastRejection()).toEqual({
    transactionId: id,
    command: 'cards/rename',
    code: 'locked',
    reason: 'Locked',
  });
});

test('a rejection from a server that sends no code reads as failed', () => {
  const pool = warmPool();
  const id = pool.run(rename, { id: 'a', title: 'Nope' });
  pool.settle([{ transactionId: id, status: 'rejected', syncId: null, reason: 'Locked' }]);
  expect(pool.lastRejection()?.code).toBe('failed');
});

test('the pool fills the stamps of an input, and saves them with the transaction', () => {
  const pool = warmPool();
  pool.run(add, { title: 'New' });
  // The transaction took `id-1`, so the record got `id-2`.
  expect(pool.get(card, 'id-2')?.title).toBe('New at 2026-01-01T00:00:00.000Z');
  expect(pool.unsent()[0]?.input).toEqual({
    id: 'id-2',
    title: 'New',
    at: '2026-01-01T00:00:00.000Z',
  });
});

test('a replay reads the saved stamps, so a reload shows the same record', () => {
  const pool = warmPool();
  pool.run(add, { title: 'New' });
  const reloaded = createPool([renameLocal, addLocal], declared, {
    stamps: testStamps('2030-01-01T00:00:00.000Z'),
  });
  reloaded.load(pool.snapshot());
  expect(reloaded.get(card, 'id-2')?.title).toBe('New at 2026-01-01T00:00:00.000Z');
});

test('a stamp that the caller gives is kept', () => {
  const pool = warmPool();
  pool.run(add, { id: 'mine', title: 'New', at: '2020-05-05T00:00:00.000Z' });
  expect(pool.get(card, 'mine')?.title).toBe('New at 2020-05-05T00:00:00.000Z');
});

test('a saved record that does not fit drops every saved record and the sync position, and says so once', () => {
  const lines: Array<string> = [];
  const pool = createPool([renameLocal], declared, {
    stamps: testStamps(),
    report: (line) => lines.push(line),
  });
  pool.load(
    poolState({
      lastSyncId: 3,
      tables: {
        Card: [
          { id: 'a', title: 'Fine' },
          { id: 'b', title: 7 },
        ],
      },
    }),
  );
  expect(pool.lastSyncId()).toBe(0);
  expect(pool.ids(card)).toEqual([]);
  expect(lines).toEqual([
    'The saved copy of Card b does not fit this build, so 2 saved records were dropped and the pool loads again from the server.',
  ]);
  // The sentence is true only when the pool asks for the groups of the dropped copy again.
  expect(pool.loadedGroups()).toEqual([]);
  expect(pool.requestedGroups()).toEqual([testGroup]);
});

test('a saved state where every record fits loads whole and reports nothing', () => {
  const lines: Array<string> = [];
  const pool = createPool([renameLocal], declared, {
    stamps: testStamps(),
    report: (line) => lines.push(line),
  });
  pool.load(poolState({ lastSyncId: 3, tables: { Card: [{ id: 'a', title: 'Old' }] } }));
  expect(pool.lastSyncId()).toBe(3);
  expect(pool.get(card, 'a')?.title).toBe('Old');
  expect(lines).toEqual([]);
});

test('a saved command whose input does not fit is refused at load, and the commands behind it run', () => {
  const lines: Array<string> = [];
  const pool = createPool([renameLocal], declared, {
    stamps: testStamps(),
    report: (line) => lines.push(line),
  });
  pool.load(
    poolState({
      lastSyncId: 3,
      tables: { Card: [{ id: 'a', title: 'Old' }] },
      pending: [
        { id: 't1', command: 'cards/rename', input: { id: 'a', title: 7 } },
        { id: 't2', command: 'cards/rename', input: { id: 'a', title: 'Good' } },
      ],
    }),
  );
  const reason =
    'The saved input of cards/rename does not fit this build, so the command was not sent.';
  expect(pool.isPending('t1')).toBe(false);
  expect(pool.unsent().map((transaction) => transaction.id)).toEqual(['t2']);
  expect(pool.lastRejection()).toEqual({
    transactionId: 't1',
    command: 'cards/rename',
    code: 'invalid-input',
    reason,
  });
  expect(pool.get(card, 'a')?.title).toBe('Good');
  expect(lines).toEqual([reason]);
});

test('a saved command that no contract declares is refused at load', () => {
  const lines: Array<string> = [];
  const pool = createPool([renameLocal], declared, {
    stamps: testStamps(),
    report: (line) => lines.push(line),
  });
  pool.load(
    poolState({
      lastSyncId: 3,
      tables: {},
      pending: [{ id: 't1', command: 'cards/gone', input: {} }],
    }),
  );
  expect(pool.unsent()).toEqual([]);
  expect(pool.lastRejection()).toMatchObject({ transactionId: 't1', code: 'invalid-input' });
  expect(pool.lastRejection()?.reason).toContain('cards/gone');
  expect(lines).toHaveLength(1);
});

test('a delta record that does not fit is not stored, and the rest of the delta applies', () => {
  const lines: Array<string> = [];
  const pool = createPool([renameLocal], declared, {
    stamps: testStamps(),
    report: (line) => lines.push(line),
  });
  pool.applyDeltas([
    {
      syncId: 4,
      transactionId: null,
      changes: [
        { model: 'Card', id: 'a', action: 'upsert', data: { title: 'Fine' }, groups: [testGroup] },
        { model: 'Card', id: 'b', action: 'upsert', data: { title: 7 }, groups: [testGroup] },
      ],
    },
  ]);
  expect(pool.get(card, 'a')?.title).toBe('Fine');
  expect(pool.get(card, 'b')).toBeUndefined();
  expect(pool.lastSyncId()).toBe(4);
  expect(lines).toEqual([
    'The server sent Card b, which does not fit this build. This build is older than the server, so the record was not stored.',
  ]);
});

test('a run whose input does not fit records an invalid-input rejection and queues nothing', () => {
  const pool = warmPool();
  const id = pool.run(rename, { id: 'a', title: 7 } as never);
  expect(pool.isPending(id)).toBe(false);
  expect(pool.unsent()).toEqual([]);
  expect(pool.get(card, 'a')?.title).toBe('Old');
  expect(pool.lastRejection()).toEqual({
    transactionId: id,
    command: 'cards/rename',
    code: 'invalid-input',
    reason: 'The input of cards/rename does not fit its fields, so it was not run.',
  });
});

test('an accepted transaction stays pending until its delta arrives', () => {
  const pool = warmPool();
  const id = pool.run(rename, { id: 'a', title: 'New' });
  pool.settle([{ transactionId: id, status: 'accepted', syncId: 4, reason: null }]);
  expect(pool.isPending(id)).toBe(true);
  pool.applyDeltas([{ syncId: 4, transactionId: null, changes: [] }]);
  expect(pool.isPending(id)).toBe(false);
});

test('a snapshot loads back with its pending transactions applied', () => {
  const pool = warmPool();
  pool.run(rename, { id: 'a', title: 'Offline' });
  const reloaded = createPool([renameLocal, addLocal], declared, { stamps: testStamps() });
  reloaded.load(pool.snapshot());
  expect(reloaded.get(card, 'a')?.title).toBe('Offline');
  expect(reloaded.unsent()).toHaveLength(1);
});

test('after a restore, the pool drops confirmed records and keeps pending work to send again', () => {
  const pool = warmPool();
  const id = pool.run(rename, { id: 'a', title: 'Mine' });
  pool.markSent([id], true);
  pool.settle([{ transactionId: id, status: 'accepted', syncId: 4, reason: null }]);
  pool.resetConfirmed();
  expect(pool.lastSyncId()).toBe(0);
  expect(pool.get(card, 'a')).toBeUndefined();
  expect(pool.unsent().map((transaction) => transaction.id)).toEqual([id]);
  pool.applyDeltas([
    {
      syncId: 1,
      transactionId: null,
      changes: [
        { model: 'Card', id: 'a', action: 'upsert', data: { title: 'Old' }, groups: [testGroup] },
      ],
    },
  ]);
  expect(pool.get(card, 'a')?.title).toBe('Mine');
  expect(pool.snapshot().lastSyncId).toBe(1);
});

function twoCards() {
  const pool = createPool([renameLocal], declared, { stamps: testStamps() });
  pool.load(
    poolState({
      lastSyncId: 3,
      tables: {
        Card: [
          { id: 'a', title: 'Old' },
          { id: 'b', title: 'Other' },
        ],
      },
    }),
  );
  return pool;
}

test('a change keeps every record that did not change as the same object', () => {
  const pool = twoCards();
  const other = pool.get(card, 'b');
  pool.run(rename, { id: 'a', title: 'New' });
  expect(pool.get(card, 'b')).toBe(other);
  const renamed = pool.get(card, 'a');
  pool.applyDeltas([{ syncId: 4, transactionId: 'x', changes: [] }]);
  expect(pool.get(card, 'a')).toBe(renamed);
});

test('the ID list stays the same array until the IDs or their order change', () => {
  const pool = twoCards();
  const order = { by: 'title', direction: 'asc' } as const;
  const ids = pool.ids(card, order);
  expect(ids).toEqual(['a', 'b']);
  pool.run(rename, { id: 'a', title: 'Older' });
  expect(pool.ids(card, order)).toBe(ids);
  pool.run(rename, { id: 'a', title: 'Zebra' });
  expect(pool.ids(card, order)).toEqual(['b', 'a']);
  expect(pool.ids(card)).toEqual(['a', 'b']);
});

test('a change wakes only the watchers of its model and its record', () => {
  const pool = twoCards();
  const woke: Array<string> = [];
  pool.watchModel(card, () => woke.push('model:Card'));
  pool.watchModel(tag, () => woke.push('model:Tag'));
  pool.watchRecord(card, 'a', () => woke.push('record:a'));
  pool.watchRecord(card, 'b', () => woke.push('record:b'));
  pool.run(rename, { id: 'a', title: 'New' });
  expect(woke).toEqual(['record:a', 'model:Card']);
  woke.length = 0;
  pool.run(rename, { id: 'a', title: 'New' });
  expect(woke).toEqual([]);
});

test('a watcher stops waking after it unsubscribes', () => {
  const pool = twoCards();
  let wakes = 0;
  const stop = pool.watchRecord(card, 'a', () => {
    wakes += 1;
  });
  stop();
  pool.run(rename, { id: 'a', title: 'New' });
  expect(wakes).toBe(0);
});
