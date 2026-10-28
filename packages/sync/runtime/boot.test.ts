import { expect, test } from 'bun:test';

import { defineCommand } from '@repo/sync/commands/define';
import { defineModel } from '@repo/sync/models/define';
import { loadPool } from '@repo/sync/runtime/boot';
import { memoryLocalDatabase } from '@repo/sync/testing/local-database';

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

test('the pool loads from any local database adapter, and each change is written back', async () => {
  const database = memoryLocalDatabase({
    lastSyncId: 2,
    tables: { Card: [{ id: 'a', title: 'Saved' }] },
    pending: [],
  });
  const pool = await loadPool(database, [rename]);
  expect(pool.get(card, 'a')?.title).toBe('Saved');
  pool.run(rename, { id: 'a', title: 'Changed' });
  await Bun.sleep(0);
  const saved = await database.read();
  expect(saved?.pending).toHaveLength(1);
  expect(saved?.lastSyncId).toBe(2);
  expect(database.writes()).toBeGreaterThan(0);
});

test('an empty local database gives an empty pool', async () => {
  const pool = await loadPool(memoryLocalDatabase(), [rename]);
  expect(pool.lastSyncId()).toBe(0);
  expect(pool.all(card)).toEqual([]);
});
