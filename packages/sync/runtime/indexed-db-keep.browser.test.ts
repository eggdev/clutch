import { afterAll, beforeAll, expect, test } from 'bun:test';

import { startBundle } from '@repo/sync/testing/browser-bundle';
import type { BrowserBundle } from '@repo/sync/testing/browser-bundle';

/**
 * A tab that loses its IndexedDB database keeps each waiting transaction that
 * it holds, also one whose save has not started or waits after a failure: it
 * writes its whole queue to a copy in `localStorage`, and each open writes the
 * copies back. It runs in a real Chromium. Run it with
 * `mise exec -- bun test ./packages/sync/runtime/indexed-db-keep.browser.test.ts`.
 */

const entrySource = `
import { localChange } from '@repo/sync/contract/command';
import { defineContract } from '@repo/sync/contract/define';
import { followLostDatabase, loadPool } from '@repo/sync/runtime/boot';
import type { SavedPool } from '@repo/sync/runtime/boot';
import { openIndexedDb } from '@repo/sync/runtime/indexed-db';
import { testCommand, testModel } from '@repo/sync/testing/pool-state';
import type { LocalDatabase } from '@repo/sync/types/local-database';

const card = testModel('Card', { id: 'string', title: 'string' });
const rename = testCommand('cards/rename', { id: 'string', title: 'string' }, 'local');
const renameLocal = localChange(rename, (draft, input) => {
  draft.put(card, input);
});
const cards = defineContract('cards', { records: [card], commands: [rename], loads: [] });
const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

/** A start of the app whose saves fail while \`failing()\` says so, with \`error\` as the failure. */
async function start(
  name: string,
  version: number,
  failing: () => boolean,
  error: () => Error,
): Promise<{ readonly database: LocalDatabase; readonly pool: SavedPool }> {
  const opened = await openIndexedDb(name, version);
  const database: LocalDatabase = {
    ...opened,
    save: (save) => (failing() ? Promise.reject(error()) : opened.save(save)),
  };
  const ids = crypto.randomUUID();
  let count = 0;
  const stamps = { newId: () => ids + '-' + (count += 1), now: () => '2026-01-01T00:00:00.000Z' };
  return { database, pool: await loadPool(database, [renameLocal], [cards], stamps, () => {}) };
}

let restarted: SavedPool | undefined;

/** Follows the loss of the database, and starts again at \`version\`. */
function follow(database: LocalDatabase, pool: SavedPool, name: string, version: number) {
  followLostDatabase(database, pool, () => {}, async () => {
    restarted = (await start(name, version, () => false, () => new Error('never'))).pool;
  });
}

async function restartedQueue() {
  for (let index = 0; index < 300 && !restarted; index += 1) {
    await sleep(10);
  }
  return restarted?.queue().map(({ input }) => input);
}

/** Two commands in a row, and a newer build opens the database before the second one saves. */
async function twoCommands() {
  const { database, pool } = await start('two-commands', 2, () => false, () => new Error('never'));
  await sleep(50);
  follow(database, pool, 'two-commands', 3);
  pool.run(rename, { id: 'a', title: 'one' });
  pool.run(rename, { id: 'b', title: 'two' });
  void openIndexedDb('two-commands', 3);
  return restartedQueue();
}

/** A command whose save failed and waits for the next attempt, and a newer build opens the database. */
async function heldInWait() {
  let failing = false;
  const { database, pool } = await start('held', 2, () => failing, () => new Error('The disk is busy.'));
  await sleep(50);
  follow(database, pool, 'held', 3);
  failing = true;
  pool.run(rename, { id: 'a', title: 'held' });
  await sleep(50);
  failing = false;
  void openIndexedDb('held', 3);
  return restartedQueue();
}

/** A tab that holds a command that it could not save, while another tab makes the database again. */
async function holdUnsaved() {
  let failing = false;
  const { database, pool } = await start('rebuilt', 2, () => failing, () => new Error('The disk is busy.'));
  await sleep(50);
  follow(database, pool, 'rebuilt', 2);
  failing = true;
  pool.run(rename, { id: 'b', title: 'from the other tab' });
  await sleep(50);
}

/** Runs a command on a full device whose drop of the records cannot be written, so the tab makes the database again. */
async function rebuildWithCommand() {
  let full = false;
  const quota = () => Object.assign(new Error('The quota has been exceeded.'), { name: 'QuotaExceededError' });
  const { pool } = await start('rebuilt', 2, () => full, quota);
  await sleep(50);
  full = true;
  const clear = IDBObjectStore.prototype.clear;
  IDBObjectStore.prototype.clear = function abortingClear(this: IDBObjectStore) {
    const request = clear.call(this);
    this.transaction.abort();
    full = false;
    return request;
  };
  pool.run(rename, { id: 'a', title: 'from the rebuilding tab' });
  await sleep(500);
  IDBObjectStore.prototype.clear = clear;
}

/** What a start reads now: each waiting row of the database. */
async function startAgain(name: string) {
  const { pool } = await start(name, 2, () => false, () => new Error('never'));
  return pool.queue().map(({ input }) => input);
}

/** A copy of one waiting row is left twice, as an open that stopped before it removed the copy leaves it. */
async function restoreTwice() {
  const row = { id: 't1', command: 'cards/rename', input: { id: 'a', title: 'One' } };
  const copy = (key: string) =>
    localStorage.setItem(key, JSON.stringify({ generation: undefined, waiting: [row] }));
  copy('local-database:twice:rescue:a');
  await openIndexedDb('twice');
  copy('local-database:twice:rescue:a');
  copy('local-database:twice:rescue:b');
  const db = await openIndexedDb('twice');
  return {
    pending: (await db.read())?.pending.map(({ id }) => id),
    copies: Object.keys(localStorage).filter((key) => key.startsWith('local-database:twice:')),
  };
}

/** A tab that loses its database to a clear in another tab keeps no copy that comes back. */
async function clearedElsewhere() {
  let failing = false;
  const { database, pool } = await start('cleared', 2, () => failing, () => new Error('The disk is busy.'));
  await sleep(50);
  follow(database, pool, 'cleared', 2);
  failing = true;
  pool.run(rename, { id: 'a', title: 'before the sign-out' });
  await sleep(50);
  await (await openIndexedDb('cleared')).clear();
  return restartedQueue();
}

Object.assign(globalThis, {
  twoCommands,
  heldInWait,
  holdUnsaved,
  rebuildWithCommand,
  startAgain,
  restoreTwice,
  clearedElsewhere,
});
`;

let chromium: BrowserBundle;

beforeAll(async () => {
  chromium = await startBundle(entrySource);
});

afterAll(async () => {
  await chromium.close();
});

test('two commands in a row, then a newer build opens the database: the start after it holds both, in order', async () => {
  const { context, open } = await chromium.context();
  const page = await open();
  expect(await page.evaluate('globalThis.twoCommands()')).toEqual([
    { id: 'a', title: 'one' },
    { id: 'b', title: 'two' },
  ]);
  await context.close();
}, 60_000);

test('a command whose save waits after a failure is kept when a newer build opens the database', async () => {
  const { context, open } = await chromium.context();
  const page = await open();
  expect(await page.evaluate('globalThis.heldInWait()')).toEqual([{ id: 'a', title: 'held' }]);
  await context.close();
}, 60_000);

test('two tabs each hold an unsaved command while one makes the database again: the next start holds both', async () => {
  const { context, open } = await chromium.context();
  const other = await open();
  await other.evaluate('globalThis.holdUnsaved()');
  const rebuilding = await open();
  await rebuilding.evaluate('globalThis.rebuildWithCommand()');
  const next = await open();
  const queue: Array<{ title: string }> = await next.evaluate('globalThis.startAgain("rebuilt")');
  expect(queue.map(({ title }) => title).toSorted()).toEqual([
    'from the other tab',
    'from the rebuilding tab',
  ]);
  await context.close();
}, 60_000);

test('a copy that is written back twice gives each waiting row once, and no copy stays', async () => {
  const { context, open } = await chromium.context();
  const page = await open();
  expect(await page.evaluate('globalThis.restoreTwice()')).toEqual({ pending: ['t1'], copies: [] });
  await context.close();
}, 60_000);

test('a tab whose database another tab cleared keeps no command that comes back after the clear', async () => {
  const { context, open } = await chromium.context();
  const page = await open();
  expect(await page.evaluate('globalThis.clearedElsewhere()')).toEqual([]);
  await context.close();
}, 60_000);
