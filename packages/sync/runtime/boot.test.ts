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

const card = testModel('Card', { id: 'string', title: 'string' });
const rename = testCommand('cards/rename', { id: 'string', title: 'string' }, 'local');
const renameLocal = localChange(rename, (draft, input) => {
  const current = draft.get(card, input.id);
  if (current) {
    draft.put(card, { ...current, title: input.title });
  }
});
const cards = defineContract('cards', { records: [card], commands: [rename], loads: [] });

/** A handle whose saves a test can wait for: ask for `nextSave()` before the act that saves. */
function watched(database: MemoryLocalDatabase): {
  readonly database: LocalDatabase;
  readonly nextSave: () => Promise<LocalSave>;
} {
  let next = Promise.withResolvers<LocalSave>();
  return {
    database: {
      ...database,
      save: async (save) => {
        const result = await database.save(save);
        const done = next;
        next = Promise.withResolvers<LocalSave>();
        done.resolve(save);
        return result;
      },
    },
    nextSave: () => next.promise,
  };
}

test('the pool loads from any local database adapter, and each change is written back', async () => {
  const memory = memoryLocalDatabase(
    poolState({ lastSyncId: 2, tables: { Card: [{ id: 'a', title: 'Saved' }] } }),
  );
  const { database, nextSave } = watched(memory);
  const first = nextSave();
  const pool = await loadPool(database, [renameLocal], [cards]);
  await first;
  expect(pool.get(card, 'a')?.title).toBe('Saved');
  const written = nextSave();
  pool.run(rename, { id: 'a', title: 'Changed' });
  await written;
  const saved = await memory.read();
  expect(saved?.pending).toHaveLength(1);
  expect(saved?.lastSyncId).toBe(2);
});

test('one delta saves only the records that it changed, with the sync position, in one save', async () => {
  const memory = memoryLocalDatabase(
    poolState({
      lastSyncId: 2,
      tables: {
        Card: [
          { id: 'a', title: 'A' },
          { id: 'b', title: 'B' },
          { id: 'c', title: 'C' },
        ],
      },
    }),
  );
  const { database, nextSave } = watched(memory);
  const first = nextSave();
  const pool = await loadPool(database, [renameLocal], [cards]);
  // The first save after a load that fit writes no record.
  const afterLoad = await first;
  expect(afterLoad.confirmed?.put).toEqual([]);
  const written = nextSave();
  pool.applyDeltas([
    {
      syncId: 3,
      transactionId: null,
      changes: [
        {
          model: 'Card',
          id: 'b',
          action: 'upsert',
          data: { title: 'New' },
          groups: [testGroup],
        },
      ],
    },
  ]);
  const save = await written;
  expect(save.confirmed?.replace).toBe(false);
  expect(save.confirmed?.put.map(({ id, row }) => [id, row?.title])).toEqual([['b', 'New']]);
  expect(save.confirmed?.remove).toEqual([]);
  expect(save.confirmed?.position.lastSyncId).toBe(3);
  const saved = await memory.read();
  expect(saved?.tables.Card?.map(({ title }) => title)).toEqual(['A', 'New', 'C']);
});

test('two tabs on one database: a waiting transaction of one stays after the saves of the other', async () => {
  const memory = memoryLocalDatabase(
    poolState({ lastSyncId: 2, tables: { Card: [{ id: 'a', title: 'Saved' }] } }),
  );
  const writerTab = watched(memory);
  // The second tab gets the lock when the first tab closes.
  const closes = Promise.withResolvers<null>();
  const otherTab = watched(memory.tab(closes.promise));
  const loadedWriter = writerTab.nextSave();
  const writer = await loadPool(writerTab.database, [renameLocal], [cards], testStamps());
  await loadedWriter;
  const other = await loadPool(otherTab.database, [renameLocal], [cards], testStamps('later'));
  // The other tab runs a command offline. It saves only its waiting transaction.
  const offline = otherTab.nextSave();
  const id = other.run(rename, { id: 'a', title: 'Offline' });
  const offlineSave = await offline;
  expect(offlineSave.confirmed).toBeUndefined();
  // The writer tab gets a delta and saves its own state, which has no waiting transaction.
  const delta = writerTab.nextSave();
  writer.applyDeltas([
    {
      syncId: 3,
      transactionId: null,
      changes: [
        {
          model: 'Card',
          id: 'a',
          action: 'upsert',
          data: { title: 'Server' },
          groups: [testGroup],
        },
      ],
    },
  ]);
  await delta;
  const afterDelta = await memory.read();
  expect(afterDelta?.pending.map((transaction) => transaction.id)).toEqual([id]);
  expect(afterDelta?.lastSyncId).toBe(3);
  // The writer tab closes. The other tab becomes the writer and saves its whole state once.
  const takeover = otherTab.nextSave();
  closes.resolve(null);
  const whole = await takeover;
  expect(whole.confirmed?.replace).toBe(true);
  const afterTakeover = await memory.read();
  expect(afterTakeover?.lastSyncId).toBe(2);
  expect(afterTakeover?.pending.map((transaction) => transaction.id)).toEqual([id]);
});

test('a tab deletes the row of its transaction when the transaction leaves its queue', async () => {
  const memory = memoryLocalDatabase(poolState({ lastSyncId: 2, tables: { Card: [] } }));
  const tab = watched(memory);
  const loaded = tab.nextSave();
  const pool = await loadPool(tab.database, [renameLocal], [cards], testStamps());
  await loaded;
  const ran = tab.nextSave();
  const id = pool.run(rename, { id: 'a', title: 'Mine' });
  await ran;
  const answered = tab.nextSave();
  pool.applyDeltas([{ syncId: 3, transactionId: id, changes: [] }]);
  const answerSave = await answered;
  expect(answerSave.done).toEqual([id]);
  const saved = await memory.read();
  expect(saved?.pending).toEqual([]);
});

test('a saved command that this build refuses at load leaves the database at the first save', async () => {
  const memory = memoryLocalDatabase(
    poolState({
      lastSyncId: 2,
      tables: {},
      pending: [{ id: 'old', command: 'cards/unknown', input: {} }],
    }),
  );
  const { database, nextSave } = watched(memory);
  const first = nextSave();
  await loadPool(database, [renameLocal], [cards], testStamps(), () => null);
  const firstSave = await first;
  expect(firstSave.done).toEqual(['old']);
  const saved = await memory.read();
  expect(saved?.pending).toEqual([]);
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

test('a save that fails is reported once, and the next change saves every record and the newest queue', async () => {
  const memory = memoryLocalDatabase(
    poolState({ lastSyncId: 2, tables: { Card: [{ id: 'a', title: 'Saved' }] } }),
  );
  const lines: Array<string> = [];
  // The device refuses two saves after the load, as a full device does.
  let refusals = 0;
  let settled = Promise.withResolvers<null>();
  const pool = await loadPool(
    {
      ...memory,
      save: async (save) => {
        try {
          if (refusals > 0) {
            refusals -= 1;
            throw new Error('The device is full.');
          }
          return await memory.save(save);
        } finally {
          settled.resolve(null);
        }
      },
    },
    [renameLocal],
    [cards],
    testStamps(),
    (line) => lines.push(line),
  );
  await settled.promise;
  const startWrites = memory.writes();
  refusals = 2;
  for (const title of ['First', 'Second', 'Third']) {
    settled = Promise.withResolvers<null>();
    pool.run(rename, { id: 'a', title });
    await settled.promise;
    // The save reads the outcome of its write in the task after it.
    await Promise.resolve();
  }
  expect(lines).toEqual([
    'This device could not save the last change. The change stays on this screen, and the next change saves again.',
  ]);
  expect(memory.writes()).toBe(startWrites + 1);
  const last = memory.saves().at(-1);
  expect(last?.confirmed?.replace).toBe(true);
  expect(last?.add).toHaveLength(3);
  const saved = await memory.read();
  expect(saved?.pending).toHaveLength(3);
});
