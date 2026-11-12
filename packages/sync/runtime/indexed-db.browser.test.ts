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
import { openIndexedDb } from '@repo/sync/runtime/indexed-db';
import { localDatabaseCases } from '@repo/sync/testing/local-database-conformance';

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

Object.assign(globalThis, { runLocalDatabaseCases: runCases });
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
