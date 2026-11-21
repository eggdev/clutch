import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';

import { chromium } from '@playwright/test';
import type { Browser, BrowserContext, Page } from '@playwright/test';

const root = path.join(import.meta.dir, '..', '..', '..');

/** Chromium, with one script built from the entry of a browser test file. */
export type BrowserBundle = {
  readonly browser: Browser;
  /** A new context, and the opener of a page at an origin that runs the script. */
  readonly context: () => Promise<{
    readonly context: BrowserContext;
    readonly open: () => Promise<Page>;
  }>;
  readonly close: () => Promise<void>;
};

/**
 * Builds `entrySource` into one script for the browser, and starts
 * Chromium. A browser test of the sync package runs its code in a real
 * Chromium, since IndexedDB exists only in a browser. It needs the Chromium
 * of `playwright install`, so it runs in the `journeys` CI job, not in
 * validate. The entry lives under .data/ so that its @repo/... imports
 * resolve through the repository's tsconfig.
 */
export async function startBundle(entrySource: string): Promise<BrowserBundle> {
  await mkdir(path.join(root, '.data'), { recursive: true });
  const folder = await mkdtemp(path.join(root, '.data', 'indexed-db-'));
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
  const bundle = await output.text();
  const browser = await chromium.launch();
  return {
    browser,
    async context() {
      const context = await browser.newContext();
      // IndexedDB needs an origin, so each page is served from one.
      await context.route('https://app.test/', (route) =>
        route.fulfill({
          contentType: 'text/html',
          body: '<!doctype html><html><body></body></html>',
        }),
      );
      return {
        context,
        async open() {
          const page = await context.newPage();
          await page.goto('https://app.test/');
          await page.addScriptTag({ content: bundle });
          return page;
        },
      };
    },
    async close() {
      await browser.close();
      await rm(folder, { recursive: true, force: true });
    },
  };
}
