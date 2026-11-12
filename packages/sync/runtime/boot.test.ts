import { expect, test } from 'bun:test';

import { localChange } from '@repo/sync/contract/command';
import { defineContract } from '@repo/sync/contract/define';
import { loadPool } from '@repo/sync/runtime/boot';
import { memoryLocalDatabase } from '@repo/sync/testing/local-database';
import { poolState, testCommand, testModel, testStamps } from '@repo/sync/testing/pool-state';

const card = testModel('Card', { id: 'string', title: 'string' });
const rename = testCommand('cards/rename', { id: 'string', title: 'string' }, 'local');
const renameLocal = localChange(rename, (draft, input) => {
  const current = draft.get(card, input.id);
  if (current) {
    draft.put(card, { ...current, title: input.title });
  }
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
    [renameLocal],
    [defineContract('cards', { records: [card], commands: [rename], loads: [] })],
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
  const pool = await loadPool(memoryLocalDatabase(), [renameLocal], []);
  expect(pool.lastSyncId()).toBe(0);
  expect(pool.ids(card)).toEqual([]);
});

test('the app stops at its start when a command that shows at once has no local change', async () => {
  const contract = defineContract('cards', { records: [], commands: [rename], loads: [] });
  expect(loadPool(memoryLocalDatabase(), [], [contract])).rejects.toThrow(
    'The app gives the object pool no local change for: cards/rename.',
  );
  const pool = await loadPool(memoryLocalDatabase(), [renameLocal], [contract]);
  expect(pool.unsent()).toEqual([]);
});

test('loading drops a saved copy that does not fit its contract, and reports the first one', async () => {
  const contract = defineContract('cards', { records: [card], commands: [rename], loads: [] });
  const lines: Array<string> = [];
  const pool = await loadPool(
    memoryLocalDatabase(poolState({ lastSyncId: 2, tables: { Card: [{ id: 'a', title: 7 }] } })),
    [renameLocal],
    [contract],
    testStamps(),
    (line) => lines.push(line),
  );
  expect(pool.lastSyncId()).toBe(0);
  expect(pool.ids(card)).toEqual([]);
  expect(lines).toEqual([
    'The saved copy of Card a does not fit this build, so 1 saved record was dropped and the pool loads again from the server.',
  ]);
});

test('the pool takes its IDs and its time from the stamps of the platform', async () => {
  const pool = await loadPool(memoryLocalDatabase(), [renameLocal], [], testStamps());
  expect(pool.run(rename, { id: 'a', title: 'New' })).toBe('id-1');
});
