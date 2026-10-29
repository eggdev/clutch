import { expect, test } from 'bun:test';

import { defineCommand } from '@repo/sync/commands/define';
import { createPool } from '@repo/sync/runtime/pool';
import { poolState, testGroup, testModel } from '@repo/sync/testing/pool-state';

type Card = { readonly id: string; readonly title: string };
const card = testModel<Card>('Card', { id: 'string', title: 'string' });
const rename = defineCommand<{ id: string; title: string }>({
  name: 'cards/rename',
  waits: 'local',
  input: { id: 'string', title: 'string' },
  apply: (draft, input) => {
    const current = draft.get(card, input.id);
    if (current) {
      draft.put(card, { ...current, title: input.title });
    }
  },
});
const archive = defineCommand<{ id: string }>({
  name: 'cards/archive',
  waits: 'server',
  input: { id: 'string' },
  apply: (draft, input) => draft.remove(card, input.id),
});

function warmPool() {
  const pool = createPool([rename, archive]);
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
  pool.settle([{ transactionId: id, status: 'rejected', syncId: null, reason: 'Locked' }]);
  expect(pool.get(card, 'a')?.title).toBe('Old');
  expect(pool.lastRejection()).toEqual({ transactionId: id, reason: 'Locked' });
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
  const reloaded = createPool([rename, archive]);
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

const tag = testModel<{ readonly id: string; readonly label: string }>('Tag', {
  id: 'string',
  label: 'string',
});

function twoCards() {
  const pool = createPool([rename, archive]);
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
