import { afterAll, beforeAll, expect, test } from 'bun:test';

import { startBundle } from '@repo/sync/testing/browser-bundle';
import type { BrowserBundle } from '@repo/sync/testing/browser-bundle';

/**
 * A tab that loses its IndexedDB database, and a database that the adapter
 * makes again, in a real Chromium: a newer build that upgrades the database
 * of an open tab, and a device that cannot save. Run it with
 * `mise exec -- bun test ./packages/sync/runtime/indexed-db-loss.browser.test.ts`.
 */

const entrySource = `
import { localChange } from '@repo/sync/contract/command';
import { defineContract } from '@repo/sync/contract/define';
import { followLostDatabase, loadPool } from '@repo/sync/runtime/boot';
import type { SavedPool } from '@repo/sync/runtime/boot';
import { openIndexedDb } from '@repo/sync/runtime/indexed-db';
import { testCommand, testModel } from '@repo/sync/testing/pool-state';

const card = testModel('Card', { id: 'string', title: 'string' });
const rename = testCommand('cards/rename', { id: 'string', title: 'string' }, 'local');
const renameLocal = localChange(rename, (draft, input) => {
  draft.put(card, input);
});
const cards = defineContract('cards', { records: [card], commands: [rename], loads: [] });

let restarted: SavedPool | undefined;
let disconnects = 0;

/**
 * Starts the app on the database of the upgrade test, as the composition root
 * does, and runs one command. A start again opens the database at version 3,
 * as the page of the newer build does. It resolves when the command is saved.
 */
async function startBeforeUpgrade(): Promise<void> {
  const database = await openIndexedDb('upgrade');
  const pool = await loadPool(database, [renameLocal], [cards]);
  followLostDatabase(
    database,
    pool,
    () => {
      disconnects += 1;
    },
    async () => {
      restarted = await loadPool(await openIndexedDb('upgrade', 3), [renameLocal], [cards]);
    },
  );
  pool.run(rename, { id: 'a', title: 'Before the upgrade' });
  for (let saved = await database.read(); !saved?.pending.length; saved = await database.read()) {
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
}

/** Opens the database of the upgrade test at version 3, as a tab of a newer build does. */
async function upgrade(): Promise<void> {
  await openIndexedDb('upgrade', 3);
}

/** What the start after the upgrade sends, once it has started, and how often the engine stopped. */
function afterUpgrade() {
  return restarted
    ? { unsent: restarted.unsent().map(({ input }) => input), disconnects }
    : undefined;
}

const ana = { userId: 'ana', organizationId: 'acme' };

/**
 * Makes room on a database whose drop of the confirmed records cannot be
 * written, as on a full device: the clear of the records aborts its database
 * transaction. Returns the read after it, what a save gives then, and the
 * copy left in \`localStorage\`.
 */
async function runRecreate() {
  const db = await openIndexedDb('recreate');
  await db.save({
    confirmed: {
      replace: true,
      put: [{ model: 'Card', id: 'a', row: { id: 'a', title: 'Saved' }, groups: ['test'], syncId: 7 }],
      remove: [],
      position: { lastSyncId: 7, groups: ['test'], actor: ana },
    },
    add: [
      { id: 't1', command: 'cards/rename', input: { id: 'a', title: 'One' }, actor: ana },
      { id: 't2', command: 'cards/rename', input: { id: 'a', title: 'Two' }, actor: ana },
    ],
    done: [],
  });
  const clear = IDBObjectStore.prototype.clear;
  IDBObjectStore.prototype.clear = function abortingClear(this: IDBObjectStore) {
    const request = clear.call(this);
    this.transaction.abort();
    return request;
  };
  let made: string;
  try {
    made = await db.makeRoom();
  } finally {
    IDBObjectStore.prototype.clear = clear;
  }
  return {
    made,
    read: await db.read(),
    saved: await db.save({ add: [], done: ['t1'] }),
    after: (await db.read())?.pending.map(({ id }) => id),
    copy: localStorage.getItem('local-database:recreate:rescue'),
  };
}

/** Leaves a copy of waiting rows in \`localStorage\`, as a recreate that stopped does, and opens the database. */
async function runRescue() {
  localStorage.setItem(
    'local-database:rescue:rescue',
    JSON.stringify({
      generation: 'kept',
      position: { lastSyncId: 0, groups: ['test'], actor: ana },
      ended: undefined,
      waiting: [{ id: 't1', command: 'cards/rename', input: { id: 'a', title: 'One' }, actor: ana }],
    }),
  );
  const db = await openIndexedDb('rescue');
  return {
    read: await db.read(),
    copy: localStorage.getItem('local-database:rescue:rescue'),
  };
}

Object.assign(globalThis, { startBeforeUpgrade, upgrade, afterUpgrade, runRecreate, runRescue });
`;

let chromium: BrowserBundle;

beforeAll(async () => {
  chromium = await startBundle(entrySource);
});

afterAll(async () => {
  await chromium.close();
});

test('a tab whose database a newer build upgrades starts again, and still sends its waiting command', async () => {
  const { context, open } = await chromium.context();
  const older = await open();
  await older.evaluate('globalThis.startBeforeUpgrade()');
  const newer = await open();
  // The open waits until the older tab lets the database go.
  await newer.evaluate('globalThis.upgrade()');
  await older.waitForFunction('globalThis.afterUpgrade() !== undefined');
  expect(await older.evaluate('globalThis.afterUpgrade()')).toEqual({
    unsent: [{ id: 'a', title: 'Before the upgrade' }],
    disconnects: 1,
  });
  await context.close();
}, 60_000);

test('a drop that cannot be written makes the database again with each waiting row, and a copy left behind comes back', async () => {
  const { context, open } = await chromium.context();
  const page = await open();
  const ana = { userId: 'ana', organizationId: 'acme' };
  const waiting = (id: string, title: string) => ({
    id,
    command: 'cards/rename',
    input: { id: 'a', title },
    actor: ana,
  });
  expect(await page.evaluate('globalThis.runRecreate()')).toEqual({
    made: 'saved',
    read: {
      lastSyncId: 0,
      tables: {},
      groups: ['test'],
      meta: {},
      pending: [waiting('t1', 'One'), waiting('t2', 'Two')],
      actor: ana,
    },
    saved: 'saved',
    after: ['t2'],
    copy: null,
  });
  expect(await page.evaluate('globalThis.runRescue()')).toEqual({
    read: {
      lastSyncId: 0,
      tables: {},
      groups: ['test'],
      meta: {},
      pending: [waiting('t1', 'One')],
      actor: ana,
    },
    copy: null,
  });
  await context.close();
}, 60_000);
