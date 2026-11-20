import { afterAll, beforeAll, expect, test } from 'bun:test';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';

import { chromium } from '@playwright/test';
import type { Browser } from '@playwright/test';

/**
 * The IndexedDB adapter, run against every local database case in a real
 * Chromium, since IndexedDB exists only in a browser. It needs the Chromium of
 * `playwright install`, so it runs in the `journeys` CI job, not in validate.
 * Run it with `mise exec -- bun test ./packages/sync/runtime/indexed-db.browser.test.ts`.
 */

const root = path.join(import.meta.dir, '..', '..', '..');
const entrySource = `
import { openDB } from 'idb';
import { localChange } from '@repo/sync/contract/command';
import { defineContract } from '@repo/sync/contract/define';
import { followLostDatabase, loadPool } from '@repo/sync/runtime/boot';
import type { SavedPool } from '@repo/sync/runtime/boot';
import { openIndexedDb } from '@repo/sync/runtime/indexed-db';
import { testCommand, testModel } from '@repo/sync/testing/pool-state';
import {
  expectOldLayoutMoved,
  localDatabaseCases,
  oldLayoutCopy,
} from '@repo/sync/testing/local-database-conformance';
import type { LocalDatabase } from '@repo/sync/types/local-database';

type Result = { readonly name: string; readonly error: string | null };

let databases = 0;

async function runCases(): Promise<Array<Result>> {
  const results: Array<Result> = [];
  for (const item of localDatabaseCases) {
    databases += 1;
    const name = 'conformance-' + databases;
    try {
      await item.run(() => openIndexedDb(name));
      results.push({ name: item.name, error: null });
    } catch (error) {
      results.push({ name: item.name, error: error instanceof Error ? error.message : String(error) });
    }
  }
  return results;
}

/** Stores a copy where version 1 kept it, then opens the adapter. Returns the error, or null. */
async function runOldLayout(): Promise<string | null> {
  const old = await openDB('old-layout', 1, {
    upgrade(upgrade) {
      upgrade.createObjectStore('pool');
    },
  });
  await old.put('pool', oldLayoutCopy, 'state');
  old.close();
  try {
    const db = await openIndexedDb('old-layout');
    await expectOldLayoutMoved(db);
    return null;
  } catch (error) {
    return error instanceof Error ? error.message : String(error);
  }
}

let held: LocalDatabase | undefined;

/** Opens the database of the lock test, and says whether this page writes the confirmed records. */
async function openForLock(): Promise<boolean> {
  held = await openIndexedDb('lock');
  return held.isWriter();
}

/** Waits until this page becomes the writer. */
async function waitForWriter(): Promise<boolean> {
  await held?.writer;
  return held?.isWriter() ?? false;
}

let clearsHeard = 0;
let followed: LocalDatabase | undefined;

/** Opens the database of the session end test, and counts each clear of another tab that this page hears. */
async function followClears(): Promise<void> {
  followed = await openIndexedDb('tabs');
  followed.onLost(() => {
    clearsHeard += 1;
  });
}

/** Clears the database of the session end test through the handle that follows. */
async function clearTabs(): Promise<void> {
  await followed?.clear();
}

/**
 * Saves a copy, takes away its generation as an older build kept none, and
 * opens two handles. Returns what a save of each handle gives.
 */
async function runNoGeneration(): Promise<Array<string>> {
  const older = await openIndexedDb('no-generation');
  await older.save({ add: oldLayoutCopy.pending, done: [] });
  const raw = await openDB('no-generation');
  await raw.delete('position', 'generation');
  raw.close();
  const first = await openIndexedDb('no-generation');
  const second = await openIndexedDb('no-generation');
  return [await first.save({ add: [], done: [] }), await second.save({ add: [], done: [] })];
}

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

Object.assign(globalThis, {
  runLocalDatabaseCases: runCases,
  runNoGeneration,
  startBeforeUpgrade,
  upgrade,
  afterUpgrade,
  runOldLayout,
  openForLock,
  waitForWriter,
  followClears,
  clearTabs,
  clearsHeard: () => clearsHeard,
});
`;

/** One case of the bundle, with the message of its error or null. */
type CaseResult = { readonly name: string; readonly error: string | null };

let browser: Browser;
let folder: string;
let bundle: string;

beforeAll(async () => {
  // The entry lives under .data/ so that its @repo/... imports resolve through the repository's tsconfig.
  await mkdir(path.join(root, '.data'), { recursive: true });
  folder = await mkdtemp(path.join(root, '.data', 'indexed-db-'));
  const entry = path.join(folder, 'entry.ts');
  await writeFile(entry, entrySource);
  const built = await Bun.build({
    entrypoints: [entry],
    target: 'browser',
    format: 'iife',
    tsconfig: path.join(root, 'tsconfig.base.json'),
  });
  if (!built.success) {
    throw new Error(built.logs.map((log) => log.message).join('\n'));
  }
  const output = built.outputs[0];
  if (!output) {
    throw new Error('Bun.build made no output.');
  }
  bundle = await output.text();
  browser = await chromium.launch();
});

afterAll(async () => {
  await browser.close();
  await rm(folder, { recursive: true, force: true });
});

test('the IndexedDB adapter passes every local database case in Chromium, and moves a copy of version 1', async () => {
  const context = await browser.newContext();
  // IndexedDB needs an origin, so the page is served from one.
  await context.route('https://app.test/', (route) =>
    route.fulfill({ contentType: 'text/html', body: '<!doctype html><html><body></body></html>' }),
  );
  const page = await context.newPage();
  await page.goto('https://app.test/');
  await page.addScriptTag({ content: bundle });
  const results = await page.evaluate<Array<CaseResult>>('globalThis.runLocalDatabaseCases()');
  // A copy of version 1 moves into the stores of version 2.
  const oldLayout = await page.evaluate<string | null>('globalThis.runOldLayout()');
  // A copy from before the generation gets one at its first open.
  const noGeneration = await page.evaluate<Array<string>>('globalThis.runNoGeneration()');
  await context.close();
  expect(results.filter((result) => result.error !== null)).toEqual([]);
  expect(oldLayout).toBeNull();
  expect(noGeneration).toEqual(['saved', 'saved']);
}, 60_000);

test('one tab writes the confirmed records, and the next tab takes over when it closes', async () => {
  const context = await browser.newContext();
  await context.route('https://app.test/', (route) =>
    route.fulfill({ contentType: 'text/html', body: '<!doctype html><html><body></body></html>' }),
  );
  const open = async () => {
    const page = await context.newPage();
    await page.goto('https://app.test/');
    await page.addScriptTag({ content: bundle });
    return page;
  };
  const first = await open();
  expect(await first.evaluate<boolean>('globalThis.openForLock()')).toBe(true);
  const second = await open();
  expect(await second.evaluate<boolean>('globalThis.openForLock()')).toBe(false);
  const takeover = second.evaluate<boolean>('globalThis.waitForWriter()');
  await first.close();
  expect(await takeover).toBe(true);
  await context.close();
}, 60_000);

test('a clear in one tab wakes each other tab of the database, and not its own', async () => {
  const context = await browser.newContext();
  await context.route('https://app.test/', (route) =>
    route.fulfill({ contentType: 'text/html', body: '<!doctype html><html><body></body></html>' }),
  );
  const open = async () => {
    const page = await context.newPage();
    await page.goto('https://app.test/');
    await page.addScriptTag({ content: bundle });
    await page.evaluate('globalThis.followClears()');
    return page;
  };
  const other = await open();
  const clearing = await open();
  await clearing.evaluate('globalThis.clearTabs()');
  await other.waitForFunction('globalThis.clearsHeard() === 1');
  expect(await clearing.evaluate<number>('globalThis.clearsHeard()')).toBe(0);
  await context.close();
}, 60_000);

test('a tab whose database a newer build upgrades starts again, and still sends its waiting command', async () => {
  const context = await browser.newContext();
  await context.route('https://app.test/', (route) =>
    route.fulfill({ contentType: 'text/html', body: '<!doctype html><html><body></body></html>' }),
  );
  const open = async () => {
    const page = await context.newPage();
    await page.goto('https://app.test/');
    await page.addScriptTag({ content: bundle });
    return page;
  };
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
