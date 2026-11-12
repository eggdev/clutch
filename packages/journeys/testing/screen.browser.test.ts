import { afterAll, beforeAll, expect, test } from 'bun:test';

import { chromium } from '@playwright/test';
import type { Browser, Page } from '@playwright/test';
import { atLargestText, screenProblems } from '@repo/journeys/testing/screen';

/**
 * The screen checks in a real Chromium, since the checks read the layout that
 * a browser computes. Each problem has a small page of its own, so the test
 * asserts the sentence of that problem and no other. It needs the Chromium of
 * `playwright install`, so it runs in the `journeys` CI job, not in validate.
 * Run it with `mise exec -- bun test ./packages/journeys/testing/screen.browser.test.ts`.
 */

let browser: Browser;

beforeAll(async () => {
  browser = await chromium.launch();
});

afterAll(async () => {
  await browser.close();
});

/** A page of the window size 400 by 300 with the content of `html`. */
async function pageWith(html: string): Promise<{ page: Page; close: () => Promise<void> }> {
  const context = await browser.newContext({ viewport: { width: 400, height: 300 } });
  const page = await context.newPage();
  await page.setContent(`<style>body { margin: 0; }</style>${html}`);
  return { page, close: () => context.close() };
}

test('a page that scrolls sideways gives the sentence of its width', async () => {
  const { page, close } = await pageWith('<div style="width: 2000px; height: 10px"></div>');
  expect(await screenProblems(page)).toEqual([
    'The page scrolls sideways: its width is 2000 px and the window is 400 px.',
  ]);
  await close();
});

test('a clipped text that is wider than its box gives the sentence of its first 40 characters', async () => {
  const { page, close } = await pageWith(
    '<p style="width: 100px; overflow: hidden; white-space: nowrap">A long sentence that does not fit in the box</p>',
  );
  expect(await screenProblems(page)).toEqual([
    '<p> "A long sentence that does not fit in the" is wider than its box, and it clips its text.',
  ]);
  await close();
});

test('a visible text past the right edge of the window gives the sentence that names it', async () => {
  const { page, close } = await pageWith(
    '<p style="position: fixed; left: 350px; top: 0; white-space: nowrap">Right side text here</p>',
  );
  expect(await screenProblems(page)).toEqual([
    '<p> "Right side text here" extends past the right edge of the window.',
  ]);
  await close();
});

test('a clean page, and a clipped text that shows an ellipsis, give no sentence', async () => {
  const { page, close } = await pageWith(
    '<main><h1>Title</h1><p>Short text.</p><p style="width: 100px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap">A long sentence that is cut</p></main>',
  );
  expect(await screenProblems(page)).toEqual([]);
  await close();
});

test('atLargestText sets the root font size to 200% and puts the old value back', async () => {
  const { page, close } = await pageWith('<p id="text">Text</p>');
  const seen = await atLargestText(page, () =>
    page.evaluate(
      () => getComputedStyle(document.querySelector('#text') ?? document.body).fontSize,
    ),
  );
  expect(seen).toBe('32px');
  expect(await page.evaluate(() => document.documentElement.style.fontSize)).toBe('');
  await close();
});

test('atLargestText puts the old font size back when the run throws', async () => {
  const { page, close } = await pageWith('<p>Text</p>');
  await expect(
    atLargestText(page, () => {
      throw new Error('The run failed.');
    }),
  ).rejects.toThrow('The run failed.');
  expect(await page.evaluate(() => document.documentElement.style.fontSize)).toBe('');
  await close();
});
