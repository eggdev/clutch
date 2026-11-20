import { expect, test } from 'bun:test';

import { localChange } from '@repo/sync/contract/command';
import { defineContract } from '@repo/sync/contract/define';
import { endSession, followSessionEnd, loadPool } from '@repo/sync/runtime/boot';
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

test('a session end in one tab stops the engine and the saves of each other tab, which starts again', async () => {
  const memory = memoryLocalDatabase(saved());
  const other = memory.tab(Promise.withResolvers().promise);
  const here = await loadPool(memory, [renameLocal], [cards]);
  const there = await loadPool(other, [renameLocal], [cards]);
  await settle();
  const heard: Array<string> = [];
  followSessionEnd(
    memory,
    here,
    () => heard.push('own disconnect'),
    () => heard.push('own start'),
  );
  followSessionEnd(
    other,
    there,
    () => heard.push('disconnect'),
    () => heard.push('start again'),
  );
  await endSession(memory, here, () => {
    heard.push('end');
  });
  // The other tab stopped its saves before it heard of the end, so it writes nothing back.
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
  row: (tab: LocalDatabase) => Promise<void>,
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
