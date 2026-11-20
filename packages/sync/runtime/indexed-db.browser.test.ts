import { afterAll, beforeAll, expect, test } from 'bun:test';

import { startBundle } from '@repo/sync/testing/browser-bundle';
import type { BrowserBundle } from '@repo/sync/testing/browser-bundle';

/**
 * The IndexedDB adapter, run against every local database case in a real
 * Chromium. `indexed-db-loss.browser.test.ts` holds a database that a tab
 * loses or makes again. Run it with
 * `mise exec -- bun test ./packages/sync/runtime/indexed-db.browser.test.ts`.
 */

const entrySource = `
import { openDB } from 'idb';
import { openIndexedDb } from '@repo/sync/runtime/indexed-db';
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

Object.assign(globalThis, {
  runLocalDatabaseCases: runCases,
  runNoGeneration,
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

let chromium: BrowserBundle;

beforeAll(async () => {
  chromium = await startBundle(entrySource);
});

afterAll(async () => {
  await chromium.close();
});

test('the IndexedDB adapter passes every local database case in Chromium, and moves a copy of version 1', async () => {
  const { context, open } = await chromium.context();
  const page = await open();
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
  const { context, open } = await chromium.context();
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
  const { context, open: openPage } = await chromium.context();
  const open = async () => {
    const page = await openPage();
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
