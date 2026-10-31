import { expect, test } from 'bun:test';

import { defineCommand } from '@repo/sync/commands/define';
import { loadPool } from '@repo/sync/runtime/boot';
import { memoryLocalDatabase } from '@repo/sync/testing/local-database';
import { poolState, testModel } from '@repo/sync/testing/pool-state';

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

test('the pool loads from any local database adapter, and each change is written back', async () => {
  const database = memoryLocalDatabase(
    poolState({ lastSyncId: 2, tables: { Card: [{ id: 'a', title: 'Saved' }] } }),
  );
  // Resolves when the pool's save finishes, so the test waits for the write itself.
  const written = Promise.withResolvers<null>();
  const pool = await loadPool(
    {
      ...database,
      write: async (state) => {
        await database.write(state);
        written.resolve(null);
      },
    },
    [rename],
  );
  expect(pool.get(card, 'a')?.title).toBe('Saved');
  pool.run(rename, { id: 'a', title: 'Changed' });
  await written.promise;
  const saved = await database.read();
  expect(saved?.pending).toHaveLength(1);
  expect(saved?.lastSyncId).toBe(2);
  expect(database.writes()).toBeGreaterThan(0);
});

test('an empty local database gives an empty pool', async () => {
  const pool = await loadPool(memoryLocalDatabase(), [rename]);
  expect(pool.lastSyncId()).toBe(0);
  expect(pool.ids(card)).toEqual([]);
});
