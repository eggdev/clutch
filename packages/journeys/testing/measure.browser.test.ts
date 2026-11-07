import { afterAll, beforeAll, expect, test } from 'bun:test';

import { chromium } from '@playwright/test';
import type { Browser, BrowserContextOptions, Page, TestInfo } from '@playwright/test';
import { startMeasure } from '@repo/journeys/testing/measure';

/**
 * The page script of the journey test in a real Chromium, since only a browser
 * fires trusted events. It needs the Chromium of `playwright install`, so it
 * runs in the `journeys` CI job, not in validate. Run it with
 * `mise exec -- bun test ./packages/journeys/testing/measure.browser.test.ts`.
 */

let browser: Browser;

beforeAll(async () => {
  browser = await chromium.launch();
});

afterAll(async () => {
  await browser.close();
});

const page = `
  <main style="padding: 40px">
    <button id="save" type="button">Save</button>
    <label for="agree">Agree</label><input id="agree" type="checkbox">
    <select aria-label="Plan"><option>Free</option><option>Pro</option></select>
    <form id="search" onsubmit="event.preventDefault()"><input aria-label="Search"></form>
    <div id="blank" style="width: 300px; height: 300px; margin-top: 20px"></div>
  </main>`;

/** A measured page with the controls above, on a desktop or a touch phone. */
async function measured(options: BrowserContextOptions = {}) {
  const context = await browser.newContext(options);
  const info = { file: import.meta.path, project: { name: 'Desktop' }, retry: 0 } as TestInfo;
  const measure = await startMeasure(context, info);
  // A real document load, so the init script runs before the page, as in a journey.
  await context.route('https://app.test/', (route) =>
    route.fulfill({ contentType: 'text/html', body: page }),
  );
  const tab = await context.newPage();
  await tab.goto('https://app.test/');
  /** The activations so far, once the page has sent each event. */
  const clicks = async () => {
    await tab.evaluate('new Promise((done) => setTimeout(done, 50))');
    return measure.clicks;
  };
  return { context, tab, measure, clicks };
}

async function hold(tab: Page, from: { x: number; y: number }, to = from, ms = 0) {
  await tab.mouse.move(from.x, from.y);
  await tab.mouse.down();
  await tab.mouse.move(to.x, to.y, { steps: 5 });
  if (ms > 0) {
    await tab.waitForTimeout(ms);
  }
  await tab.mouse.up();
}

test('a click, Space or Enter on a button, a select choice and a label each count once', async () => {
  const { context, tab, measure, clicks } = await measured();
  await tab.getByRole('button', { name: 'Save' }).click();
  expect(await clicks()).toBe(1);
  await tab.getByRole('button', { name: 'Save' }).press('Space');
  expect(await clicks()).toBe(2);
  await tab.getByRole('button', { name: 'Save' }).press('Enter');
  expect(await clicks()).toBe(3);
  await tab.getByLabel('Plan').selectOption('Pro');
  expect(await clicks()).toBe(4);
  // The label clicks its checkbox in the same task, so the pair counts once.
  await tab.getByText('Agree').click();
  expect(await tab.getByRole('checkbox').isChecked()).toBe(true);
  expect(await clicks()).toBe(5);
  expect(measure.steps).toBe(5);
  await context.close();
});

test('typing counts keys only, and Enter that sends a form with no submit button counts once', async () => {
  const { context, tab, measure, clicks } = await measured();
  await tab.getByLabel('Search').pressSequentially('abc');
  expect(await clicks()).toBe(0);
  expect(measure.keys).toBe(3);
  await tab.getByLabel('Search').press('Enter');
  expect(await clicks()).toBe(1);
  await context.close();
});

test('a press and hold or a drag that activates nothing does not count, and a short tap does', async () => {
  const { context, tab, clicks } = await measured();
  const box = await tab.locator('#blank').boundingBox();
  if (box === null) {
    throw new Error('The blank area has no box.');
  }
  const middle = { x: box.x + 150, y: box.y + 150 };
  await hold(tab, middle, middle, 700);
  expect(await clicks()).toBe(0);
  await hold(tab, middle, { x: middle.x + 100, y: middle.y + 100 });
  expect(await clicks()).toBe(0);
  // A press and hold on a button activates it, so it counts.
  const save = await tab.getByRole('button', { name: 'Save' }).boundingBox();
  if (save === null) {
    throw new Error('The button has no box.');
  }
  await hold(tab, { x: save.x + 5, y: save.y + 5 }, { x: save.x + 5, y: save.y + 5 }, 700);
  expect(await clicks()).toBe(1);
  await hold(tab, middle);
  expect(await clicks()).toBe(2);
  await context.close();
});

test('a tap on a touch phone counts once', async () => {
  const { context, tab, clicks } = await measured({ hasTouch: true, isMobile: true });
  await tab.getByRole('button', { name: 'Save' }).tap();
  expect(await clicks()).toBe(1);
  await context.close();
});
