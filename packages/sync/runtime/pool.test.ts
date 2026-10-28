import { expect, test } from 'bun:test';

import { defineCommand } from '@repo/sync/commands/define';
import { defineModel } from '@repo/sync/models/define';
import { createPool } from '@repo/sync/runtime/pool';

type Card = { readonly id: string; readonly title: string };
const card = defineModel<Card>('Card');
const rename = defineCommand<{ id: string; title: string }>({
  name: 'cards/rename',
  waits: 'local',
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
  apply: (draft, input) => draft.remove(card, input.id),
});

function warmPool() {
  const pool = createPool([rename, archive]);
  pool.load({ lastSyncId: 3, tables: { Card: [{ id: 'a', title: 'Old' }] }, pending: [] });
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
      changes: [{ model: 'Card', id: 'b', action: 'upsert', data: { title: 'Theirs' } }],
    },
  ]);
  expect(pool.get(card, 'a')?.title).toBe('Mine');
  expect(pool.get(card, 'b')?.title).toBe('Theirs');
  expect(pool.isPending(id)).toBe(true);
  pool.applyDeltas([
    {
      syncId: 5,
      transactionId: id,
      changes: [{ model: 'Card', id: 'a', action: 'upsert', data: { title: 'Mine' } }],
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
      changes: [{ model: 'Card', id: 'a', action: 'delete', data: null }],
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
      changes: [{ model: 'Card', id: 'a', action: 'upsert', data: { title: 'Old' } }],
    },
  ]);
  expect(pool.get(card, 'a')?.title).toBe('Mine');
  expect(pool.snapshot().lastSyncId).toBe(1);
});
