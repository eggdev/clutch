import { expect, test } from 'bun:test';

import { localChange } from '@repo/sync/contract/command';
import { defineContract } from '@repo/sync/contract/define';
import { endSession, loadPool } from '@repo/sync/runtime/boot';
import { memoryLocalDatabase } from '@repo/sync/testing/local-database';
import { poolState, testCommand, testModel } from '@repo/sync/testing/pool-state';
import type { LocalDatabase } from '@repo/sync/types/local-database';

/**
 * The end of a session on the device. The saves of the old pool stop before
 * the local database is cleared, so no change of the old screen writes the
 * old state back.
 */

const card = testModel('Card', { id: 'string', title: 'string' });
const rename = testCommand('cards/rename', { id: 'string', title: 'string' }, 'local');
const renameLocal = localChange(rename, (draft, input) => {
  const current = draft.get(card, input.id);
  if (current) {
    draft.put(card, { ...current, title: input.title });
  }
});
const cards = defineContract('cards', { records: [card], commands: [rename], loads: [] });

const saved = () => poolState({ lastSyncId: 2, tables: { Card: [{ id: 'a', title: 'Saved' }] } });

/** Lets the saves that wait for a microtask run. */
const settle = () =>
  new Promise((resolve) => {
    setTimeout(resolve, 10);
  });

test('after the stop, no change of the old pool reaches the local database', async () => {
  const memory = memoryLocalDatabase(saved());
  const pool = await loadPool(memory, [renameLocal], [cards]);
  await settle();
  const before = memory.writes();
  await pool.stop();
  pool.run(rename, { id: 'a', title: 'After the stop' });
  await settle();
  expect(memory.writes()).toBe(before);
  const read = await memory.read();
  expect(read?.pending).toEqual([]);
});

test('the stop lets a save that runs finish, and the save after it never starts', async () => {
  const memory = memoryLocalDatabase(saved());
  let release: (() => void) | undefined;
  let saves = 0;
  const slow: LocalDatabase = {
    ...memory,
    save: async (save) => {
      saves += 1;
      await new Promise<void>((resolve) => {
        release = resolve;
      });
      await memory.save(save);
    },
  };
  const pool = await loadPool(slow, [renameLocal], [cards]);
  // The first save of the start runs now. A change queues one more save behind it.
  pool.run(rename, { id: 'a', title: 'Queued' });
  let stopped = false;
  const stopping = pool.stop().then(() => {
    stopped = true;
  });
  await settle();
  expect(stopped).toBe(false);
  release?.();
  await stopping;
  expect(saves).toBe(1);
});

test('the end of a session stops the engine and the saves, then clears the local database', async () => {
  const memory = memoryLocalDatabase(saved());
  const pool = await loadPool(memory, [renameLocal], [cards]);
  await settle();
  const order: Array<string> = [];
  const database: LocalDatabase = {
    ...memory,
    clear: async () => {
      order.push('clear');
      await memory.clear();
    },
  };
  await endSession(database, pool, () => {
    order.push('disconnect');
  });
  pool.run(rename, { id: 'a', title: 'After the end' });
  await settle();
  expect(order).toEqual(['disconnect', 'clear']);
  expect(await memory.read()).toBeUndefined();
});
