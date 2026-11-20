import { afterAll, beforeAll, expect, test } from 'bun:test';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';

import { chromium } from '@playwright/test';
import type { Browser, BrowserContext } from '@playwright/test';

/**
 * The IndexedDB adapter, run against every local database case in a real
 * Chromium, since IndexedDB exists only in a browser. It needs the Chromium of
 * `playwright install`, so it runs in the `journeys` CI job, not in validate.
 * Run it with `mise exec -- bun test ./packages/sync/runtime/indexed-db.browser.test.ts`.
 */

const root = path.join(import.meta.dir, '..', '..', '..');
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

Object.assign(globalThis, {
  runLocalDatabaseCases: runCases,
  runOldLayout,
  openForLock,
  waitForWriter,
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

test('the IndexedDB adapter passes every local database case in Chromium', async () => {
  const context = await browser.newContext();
  // IndexedDB needs an origin, so the page is served from one.
  await context.route('https://app.test/', (route) =>
    route.fulfill({ contentType: 'text/html', body: '<!doctype html><html><body></body></html>' }),
  );
  const page = await context.newPage();
  await page.goto('https://app.test/');
  await page.addScriptTag({ content: bundle });
  const results = await page.evaluate<Array<CaseResult>>('globalThis.runLocalDatabaseCases()');
  await context.close();
  expect(results.filter((result) => result.error !== null)).toEqual([]);
}, 60_000);

/** A page of the test origin with the bundle loaded. */
async function openPage(context: BrowserContext) {
  const page = await context.newPage();
  await page.goto('https://app.test/');
  await page.addScriptTag({ content: bundle });
  return page;
}

/** A browser context that serves the test origin, since IndexedDB needs one. */
async function originContext() {
  const context = await browser.newContext();
  await context.route('https://app.test/', (route) =>
    route.fulfill({ contentType: 'text/html', body: '<!doctype html><html><body></body></html>' }),
  );
  return context;
}

test('the IndexedDB adapter moves a copy of version 1 into its stores', async () => {
  const context = await originContext();
  const page = await openPage(context);
  const error = await page.evaluate<string | null>('globalThis.runOldLayout()');
  await context.close();
  expect(error).toBeNull();
}, 60_000);

test('one tab writes the confirmed records, and the next tab takes over when it closes', async () => {
  const context = await originContext();
  const first = await openPage(context);
  expect(await first.evaluate<boolean>('globalThis.openForLock()')).toBe(true);
  const second = await openPage(context);
  expect(await second.evaluate<boolean>('globalThis.openForLock()')).toBe(false);
  const takeover = second.evaluate<boolean>('globalThis.waitForWriter()');
  await first.close();
  expect(await takeover).toBe(true);
  await context.close();
}, 60_000);
