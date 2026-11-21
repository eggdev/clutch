import { expect, test } from 'bun:test';

import { localChange } from '@repo/sync/contract/command';
import { defineContract } from '@repo/sync/contract/define';
import { loadPool } from '@repo/sync/runtime/boot';
import { memoryLocalDatabase } from '@repo/sync/testing/local-database';
import type { MemoryLocalDatabase } from '@repo/sync/testing/local-database';
import {
  poolState,
  testCommand,
  testGroup,
  testModel,
  testStamps,
} from '@repo/sync/testing/pool-state';
import type { LocalDatabase, LocalSave } from '@repo/sync/types/local-database';
import type { Delta } from '@repo/sync/types/protocol';

/**
 * A device that cannot save. The waiting transactions are what a device must
 * never lose, and the confirmed records are a cache of the server. So after a
 * failed save the next attempt waits, and a device that keeps failing, or that
 * is full, gives up its confirmed records to make room for the waiting ones.
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
const ana = { userId: 'ana', organizationId: 'acme' };

const couldNotSave =
  'This device could not save the last change. The change stays on this screen, and the next change saves again.';
const madeRoom =
  'This device could not save, so the app removed its saved copy of the server data to make room, and nothing you did is lost.';

/** Many records of Ana, saved at sync ID 40. */
function manyRecords() {
  const rows = Array.from({ length: 40 }, (_, index) => ({ id: `c${index}`, title: 'Saved' }));
  return { ...poolState({ lastSyncId: 40, tables: { Card: rows } }), actor: ana };
}

/** An error of a full device, as IndexedDB gives it. */
function quotaError() {
  return Object.assign(new Error('The quota has been exceeded.'), { name: 'QuotaExceededError' });
}

/**
 * A device whose saves fail with the error that `failing` gives, which gets
 * how often the pool made room. It keeps each save that the pool tried.
 */
function failingDevice(memory: MemoryLocalDatabase, failing: (rooms: number) => unknown) {
  const tried: Array<LocalSave> = [];
  let rooms = 0;
  const database: LocalDatabase = {
    ...memory,
    save: (save) => {
      tried.push(save);
      const error = failing(rooms);
      return error ? Promise.reject(error) : memory.save(save);
    },
    makeRoom: () => {
      rooms += 1;
      return memory.makeRoom();
    },
  };
  return { database, tried, rooms: () => rooms };
}

/** Lets the saves that wait for a microtask run. */
const settle = () =>
  new Promise((resolve) => {
    setTimeout(resolve, 10);
  });

/** Waits that a test ends one at a time, and the length of each. */
function heldWaits() {
  const lengths: Array<number> = [];
  const ends: Array<() => void> = [];
  return {
    wait: (ms: number) => {
      lengths.push(ms);
      return new Promise<void>((resolve) => {
        ends.push(resolve);
      });
    },
    lengths,
    /** Ends the oldest wait, and lets the save after it run. */
    async end() {
      ends.shift()?.();
      await settle();
    },
    pending: () => ends.length,
  };
}

test('a full device gives up its confirmed records, keeps each waiting transaction, and loads again from the server', async () => {
  const memory = memoryLocalDatabase(manyRecords());
  let full = false;
  // The device is full until the pool makes room.
  const device = failingDevice(memory, (rooms) => (full && rooms === 0 ? quotaError() : undefined));
  const lines: Array<string> = [];
  const pool = await loadPool(device.database, [renameLocal], [cards], testStamps(), (line) =>
    lines.push(line),
  );
  await settle();
  full = true;
  pool.run(rename, { id: 'c1', title: 'First' });
  await settle();
  pool.run(rename, { id: 'c2', title: 'Second' });
  pool.run(rename, { id: 'c3', title: 'Third' });
  await settle();
  expect(device.rooms()).toBe(1);
  expect(lines).toEqual([couldNotSave, madeRoom]);
  // The screen keeps its records.
  expect(pool.get(card, 'c9')?.title).toBe('Saved');
  expect(pool.get(card, 'c1')?.title).toBe('First');
  // After making room, a save writes only the waiting transactions.
  const afterRoom = device.tried.slice(device.tried.findIndex((save) => save.add.length > 0) + 1);
  expect(afterRoom.every((save) => save.confirmed === undefined)).toBe(true);
  await pool.stop();

  const next = await loadPool(memory, [renameLocal], [cards], testStamps('later'));
  expect(next.queue().map(({ input }) => input)).toEqual([
    { id: 'c1', title: 'First' },
    { id: 'c2', title: 'Second' },
    { id: 'c3', title: 'Third' },
  ]);
  expect(next.lastSyncId()).toBe(0);
  expect(next.ids(card)).toEqual([]);
  // A pull from 0 loads each record again, and moves the pool to the head of the log.
  expect(next.confirmActor(ana)).toBe(true);
  const snapshot: Delta = {
    syncId: 52,
    transactionId: null,
    changes: manyRecords().tables.Card.map((row) => ({
      model: 'Card',
      id: row.id,
      action: 'upsert' as const,
      data: { title: 'Server' },
      groups: [testGroup],
    })),
  };
  next.applyGroups([testGroup], [snapshot]);
  next.applyDeltas([{ syncId: 52, transactionId: null, changes: [] }]);
  expect(next.lastSyncId()).toBe(52);
  expect(next.ids(card)).toHaveLength(40);
  expect(next.get(card, 'c9')?.title).toBe('Server');
  expect(next.get(card, 'c3')?.title).toBe('Third');
});

test('a device that keeps failing waits longer between saves, and never writes every record again on each change', async () => {
  const memory = memoryLocalDatabase(manyRecords());
  const device = failingDevice(memory, () => new Error('The device is full.'));
  const waits = heldWaits();
  const lines: Array<string> = [];
  const pool = await loadPool(
    device.database,
    [renameLocal],
    [cards],
    testStamps(),
    (line) => lines.push(line),
    waits.wait,
  );
  await settle();
  // The first save of the start failed, and the next one waits.
  expect(device.tried).toHaveLength(1);
  for (let index = 0; index < 10; index += 1) {
    pool.run(rename, { id: 'c1', title: `Change ${index}` });
  }
  await settle();
  expect(device.tried).toHaveLength(1);
  // Two more failures in a row make room, and the save after it runs at once.
  await waits.end();
  await waits.end();
  expect(device.rooms()).toBe(1);
  expect(device.tried).toHaveLength(4);
  for (let index = 0; index < 10; index += 1) {
    pool.run(rename, { id: 'c2', title: `Change ${index}` });
  }
  await settle();
  expect(device.tried).toHaveLength(4);
  await waits.end();
  expect(device.tried).toHaveLength(5);
  expect(device.rooms()).toBe(1);
  // No save after making room writes a confirmed record.
  expect(device.tried.slice(3).every((save) => save.confirmed === undefined)).toBe(true);
  expect(waits.lengths).toEqual([200, 400, 800, 1600]);
  expect(waits.pending()).toBe(1);
  expect(lines).toEqual([couldNotSave, madeRoom]);
  await pool.stop();
});

/** The stamps of a second tab, whose IDs differ from those of `testStamps`. */
function tabStamps(prefix: string) {
  let count = 0;
  return { ...testStamps(), newId: () => `${prefix}-${(count += 1)}` };
}

/** A live delta at `syncId` that renames one card. */
const liveDelta = (syncId: number, id: string): Delta => ({
  syncId,
  transactionId: null,
  changes: [{ model: 'Card', id, action: 'upsert', data: { title: 'Live' }, groups: [testGroup] }],
});

test('a tab that is not the writer makes room, and the writer then saves no record and no position over it', async () => {
  const memory = memoryLocalDatabase(manyRecords());
  let full = false;
  // The other tab cannot save until it makes room.
  const other = failingDevice(memory.tab(new Promise(() => {})), (rooms) =>
    full && rooms === 0 ? quotaError() : undefined,
  );
  const writer = await loadPool(memory, [renameLocal], [cards], testStamps(), () => {});
  const tab = await loadPool(other.database, [renameLocal], [cards], tabStamps('n'), () => {});
  await settle();
  full = true;
  tab.run(rename, { id: 'c1', title: 'From the other tab' });
  await settle();
  expect(other.rooms()).toBe(1);
  writer.applyDeltas([liveDelta(41, 'c5')]);
  writer.run(rename, { id: 'c2', title: 'From the writer' });
  await settle();
  const saved = await memory.read();
  expect(saved?.lastSyncId).toBe(0);
  expect(saved?.tables).toEqual({});
  expect(saved?.pending.map(({ input }) => input)).toEqual([
    { id: 'c1', title: 'From the other tab' },
    { id: 'c2', title: 'From the writer' },
  ]);
  await writer.stop();
  await tab.stop();
  // The next start reads sync ID 0, so the pool loads every record again from the server.
  const next = await loadPool(
    memory.tab(Promise.resolve()),
    [renameLocal],
    [cards],
    testStamps('later'),
  );
  expect(next.lastSyncId()).toBe(0);
  expect(next.queue()).toHaveLength(2);
});

test('the writer makes room, a tab that is not the writer saves a row after it, and a start in the middle saves records again', async () => {
  const memory = memoryLocalDatabase(manyRecords());
  const device = failingDevice(memory, (rooms) => (rooms === 0 ? quotaError() : undefined));
  const other = memory.tab(new Promise(() => {}));
  const writer = await loadPool(device.database, [renameLocal], [cards], testStamps(), () => {});
  await settle();
  expect(device.rooms()).toBe(1);
  const tab = await loadPool(other, [renameLocal], [cards], tabStamps('n'), () => {});
  tab.run(rename, { id: 'c1', title: 'From the other tab' });
  writer.applyDeltas([liveDelta(41, 'c5')]);
  await settle();
  const emptied = await memory.read();
  expect(emptied?.lastSyncId).toBe(0);
  expect(emptied?.pending).toHaveLength(1);
  // The other tab starts again in the middle, then becomes the writer: its saves write records again.
  await tab.stop();
  await writer.stop();
  const restartedHandle = memory.tab(Promise.resolve());
  const restarted = await loadPool(restartedHandle, [renameLocal], [cards], tabStamps('r'));
  expect(restarted.lastSyncId()).toBe(0);
  expect(restarted.confirmActor(ana)).toBe(true);
  restarted.applyGroups([testGroup], [liveDelta(60, 'c9')]);
  restarted.applyDeltas([{ syncId: 60, transactionId: null, changes: [] }]);
  await settle();
  const saved = await memory.read();
  expect(saved?.lastSyncId).toBe(60);
  expect(saved?.tables.Card).toEqual([{ id: 'c9', title: 'Live' }]);
  expect(saved?.pending).toHaveLength(1);
});
