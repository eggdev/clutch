import { expect, test } from 'bun:test';

import { localChange } from '@repo/sync/contract/command';
import { defineContract } from '@repo/sync/contract/define';
import { endSession, followLostDatabase, loadPool } from '@repo/sync/runtime/boot';
import type { SavedPool } from '@repo/sync/runtime/boot';
import { memoryLocalDatabase } from '@repo/sync/testing/local-database';
import { poolState, testCommand, testGroup, testModel } from '@repo/sync/testing/pool-state';
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
      return memory.save(save);
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

test('a session end in one tab stops the engine and the saves of each other tab, which starts again', async () => {
  const memory = memoryLocalDatabase(saved());
  const other = memory.tab(Promise.withResolvers().promise);
  const here = await loadPool(memory, [renameLocal], [cards]);
  const there = await loadPool(other, [renameLocal], [cards]);
  await settle();
  const heard: Array<string> = [];
  followLostDatabase(
    memory,
    here,
    () => heard.push('own disconnect'),
    () => heard.push('own start'),
  );
  followLostDatabase(
    other,
    there,
    () => heard.push('disconnect'),
    () => heard.push('start again'),
  );
  await endSession(memory, here, () => {
    heard.push('end');
  });
  // The message of the end reaches the other tab after this change. Its save
  // finds the database cleared, so it writes nothing back, and it stops.
  there.run(rename, { id: 'a', title: 'After the end' });
  await settle();
  expect(heard).toEqual(['end', 'disconnect', 'start again']);
  expect(await memory.read()).toBeUndefined();
});

const ana = { userId: 'ana', organizationId: 'acme' };
const ben = { userId: 'ben', organizationId: 'acme' };

/**
 * The order of the sign-out race. Tab A ends Ana's session and clears the
 * database. Tab B heard nothing and saves a row of Ana with `row`: before
 * the next start of tab A reads the database, or after it. Ben signs in on
 * tab A, and runs his own command. It returns what the start after that
 * sends, and each sentence that the pools reported.
 */
async function raceAfterSessionEnd(
  row: (tab: LocalDatabase) => Promise<unknown>,
  when: 'before the next start' | 'after the next start',
) {
  const lines: Array<string> = [];
  const memory = memoryLocalDatabase({ ...saved(), actor: ana });
  const start = () =>
    loadPool(memory, [renameLocal], [cards], undefined, (line) => lines.push(line));
  const here = await start();
  await settle();
  await endSession(memory, here, () => {
    // The engine of this test never started.
  });
  const tab = memory.tab(Promise.withResolvers().promise);
  if (when === 'before the next start') {
    await row(tab);
  }
  const next = await start();
  if (when === 'after the next start') {
    await row(tab);
  }
  expect(next.confirmActor(ben)).toBe(true);
  next.run(rename, { id: 'a', title: "Ben's" });
  await settle();
  await next.stop();
  const restart = await start();
  expect(restart.confirmActor(ben)).toBe(true);
  return { sent: restart.unsent().map(({ input }) => input), lines };
}

const anasRow = (tab: LocalDatabase) =>
  tab.save({
    add: [{ id: 'anas', command: 'cards/rename', input: { id: 'a', title: "Ana's" }, actor: ana }],
    done: [],
  });
const untaggedRow = (tab: LocalDatabase) =>
  tab.save({
    add: [{ id: 'old', command: 'cards/rename', input: { id: 'a', title: "Ana's" } }],
    done: [],
  });
const otherActor =
  'This device held unsent changes of another account, so the app removed them and did not send them.';

for (const when of ['before the next start', 'after the next start'] as const) {
  test(`after a session end, a row of the old actor that another tab saves ${when} is never sent as the next one`, async () => {
    const { sent, lines } = await raceAfterSessionEnd(anasRow, when);
    expect(sent).toEqual([{ id: 'a', title: "Ben's" }]);
    expect(lines).toEqual([otherActor]);
  });

  test(`after a session end, a row with no actor that another tab saves ${when} is never sent as the next one`, async () => {
    const { sent } = await raceAfterSessionEnd(untaggedRow, when);
    expect(sent).toEqual([{ id: 'a', title: "Ben's" }]);
  });
}

function noEngine() {
  // The engine of this test never started.
}

/**
 * Ana's session ends on the device, and the next one starts. `before` runs
 * on the pool of that start, then the app starts again. It returns what the
 * start after that sends, the mark that the database reads then, and each
 * sentence that the pools reported.
 */
async function startAgainAfterSessionEnd(before: (pool: SavedPool) => void) {
  const lines: Array<string> = [];
  const memory = memoryLocalDatabase({ ...saved(), actor: ana });
  const start = () =>
    loadPool(memory, [renameLocal], [cards], undefined, (line) => lines.push(line));
  await endSession(memory, await start(), noEngine);
  const next = await start();
  before(next);
  await settle();
  await next.stop();
  const restart = await start();
  await settle();
  return {
    sent: restart.unsent().map(({ input }) => input),
    read: await memory.read(),
    lines,
  };
}

test('with a server that names no actor, work done after the first Groups message survives a restart', async () => {
  const { sent, read, lines } = await startAgainAfterSessionEnd((pool) => {
    // A server of an older build: the first Groups message names no actor.
    expect(pool.confirmActor()).toBe(true);
    pool.applyGroups([], []);
    pool.run(rename, { id: 'a', title: 'After the Groups message' });
  });
  expect(sent).toEqual([{ id: 'a', title: 'After the Groups message' }]);
  expect(read?.ended).toBeUndefined();
  expect(lines).toEqual([]);
});

test('after a session end, work done before the first Groups message survives a restart', async () => {
  const { sent, read, lines } = await startAgainAfterSessionEnd((pool) => {
    pool.run(rename, { id: 'a', title: 'Offline' });
  });
  expect(sent).toEqual([{ id: 'a', title: 'Offline' }]);
  // The mark stays until the first Groups message, and no load drops a row again.
  expect(read?.ended).toBeUndefined();
  expect(lines).toEqual([]);
});

/**
 * The sign-out race of two tabs that both started before it. Tab A ends
 * Ana's session and clears the database. Tab B has not heard of it yet, and
 * a save of B starts after the clear: `late` makes the change that saves.
 * The message of the clear reaches B only after that change.
 * `writer` says whether tab B writes the confirmed records. It returns the
 * handle of tab A, and how often tab B started again.
 */
async function lateSaveOfOtherTab(
  writer: 'B writes' | 'A writes',
  late: (pool: SavedPool) => void,
) {
  const memory = memoryLocalDatabase({
    ...poolState({
      lastSyncId: 2,
      tables: {
        Card: [
          { id: 'a', title: 'Saved' },
          { id: 'b', title: 'Ana' },
        ],
      },
    }),
    actor: ana,
  });
  // The first handle of the memory fake writes the confirmed records.
  const other = memory.tab(Promise.withResolvers().promise);
  const [handleA, handleB] = writer === 'B writes' ? [other, memory] : [memory, other];
  const tabA = await loadPool(handleA, [renameLocal], [cards]);
  const tabB = await loadPool(handleB, [renameLocal], [cards]);
  let restarts = 0;
  followLostDatabase(handleB, tabB, noEngine, () => {
    restarts += 1;
  });
  await settle();
  await endSession(handleA, tabA, noEngine);
  // The message of the clear reaches tab B in a later task, after this change.
  late(tabB);
  await settle();
  return { handleA, restarts: () => restarts };
}

test('a save of the writer tab that lands after a session end in another tab writes nothing', async () => {
  const { handleA, restarts } = await lateSaveOfOtherTab('B writes', (pool) => {
    // A socket message of tab B changes a record of Ana.
    pool.applyDeltas([
      {
        syncId: 3,
        transactionId: null,
        changes: [
          {
            model: 'Card',
            id: 'b',
            action: 'upsert',
            data: { title: 'Ana other' },
            groups: [testGroup],
          },
        ],
      },
    ]);
  });
  expect(await handleA.read()).toBeUndefined();
  // The mark of the session end is still there.
  await handleA.save({
    add: [{ id: 'next', command: 'cards/rename', input: { id: 'a', title: 'Next' } }],
    done: [],
  });
  const marked = await handleA.read();
  expect(marked?.ended).toBe(true);
  expect(restarts()).toBe(1);
  // Ben starts on the device, and sees no record of Ana before he connects.
  // The mark drops the row with no actor, which may be Ana's work.
  const lines: Array<string> = [];
  const next = await loadPool(handleA, [renameLocal], [cards], undefined, (line) =>
    lines.push(line),
  );
  expect(next.ids(card)).toEqual([]);
  expect(next.queue()).toEqual([]);
  expect(lines).toEqual([otherActor]);
});

test('a waiting row of a tab that is no writer, saved after a session end in another tab, is never loaded', async () => {
  const { handleA, restarts } = await lateSaveOfOtherTab('A writes', (pool) => {
    pool.run(rename, { id: 'a', title: "Ana's edit" });
  });
  expect(await handleA.read()).toBeUndefined();
  expect(restarts()).toBe(1);
  const next = await loadPool(handleA, [renameLocal], [cards]);
  expect(next.queue()).toEqual([]);
  expect(next.unsent()).toEqual([]);
});

test('a tab that loses its database keeps its whole queue before it stops, and again before it starts again', async () => {
  const memory = memoryLocalDatabase(saved());
  const kept: Array<Array<unknown>> = [];
  let lose: (() => void) | undefined;
  const database: LocalDatabase = {
    ...memory,
    onLost(listener) {
      lose = listener;
      return () => {};
    },
    keep: (rows) => kept.push(rows.map(({ input }) => input)),
  };
  const pool = await loadPool(database, [renameLocal], [cards]);
  await settle();
  const order: Array<string> = [];
  followLostDatabase(
    database,
    pool,
    () => order.push(`disconnect after ${kept.length} keep`),
    () => order.push(`restart after ${kept.length} keeps`),
  );
  pool.run(rename, { id: 'a', title: 'One' });
  pool.run(rename, { id: 'a', title: 'Two' });
  lose?.();
  pool.run(rename, { id: 'a', title: 'Three' });
  await settle();
  expect(order).toEqual(['disconnect after 1 keep', 'restart after 2 keeps']);
  expect(kept).toEqual([
    [
      { id: 'a', title: 'One' },
      { id: 'a', title: 'Two' },
    ],
    [
      { id: 'a', title: 'One' },
      { id: 'a', title: 'Two' },
      { id: 'a', title: 'Three' },
    ],
  ]);
});
