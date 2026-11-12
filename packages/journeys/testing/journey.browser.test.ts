import { afterAll, beforeAll, expect, test } from 'bun:test';

import { chromium } from '@playwright/test';
import type { Browser } from '@playwright/test';
import { runSteps } from '@repo/journeys/testing/journey';
import { advance, open, see, text } from '@repo/journeys/testing/steps';

/**
 * The clock step in a real Chromium. The page sets a timer of one minute, and
 * the journey moves its clock past it, so the test proves that `advance`
 * fires a timer of the page with no wait of a minute. It needs the Chromium
 * of `playwright install`, so it runs in the `journeys` CI job, not in
 * validate. Run it with
 * `mise exec -- bun test ./packages/journeys/testing/journey.browser.test.ts`.
 */

const minute = 60_000;
const page = `<!doctype html><title>Timer</title><main><p id="out">Waiting</p></main>
<script>setTimeout(() => { document.getElementById('out').textContent = 'The minute passed'; }, ${minute});</script>`;

let browser: Browser;
let server: ReturnType<typeof Bun.serve>;

beforeAll(async () => {
  browser = await chromium.launch();
  server = Bun.serve({
    port: 0,
    fetch: () => new Response(page, { headers: { 'content-type': 'text/html' } }),
  });
});

afterAll(async () => {
  await browser.close();
  await server.stop(true);
});

/** Runs the steps on a new device that opens the timer page, and gives how long the run took. */
async function run(steps: Parameters<typeof runSteps>[0]): Promise<number> {
  const baseURL = `http://127.0.0.1:${server.port}`;
  const context = await browser.newContext({ baseURL });
  const first = await context.newPage();
  const start = performance.now();
  try {
    await runSteps(steps, { first, browser, baseURL });
  } finally {
    await context.close();
  }
  return performance.now() - start;
}

test('advance moves the clock of the device past a timer of the page, with no wait', async () => {
  const took = await run([open('/'), advance(minute), see(text('The minute passed'))]);
  // The timer is a minute long. The run ends in a small part of that.
  expect(took).toBeLessThan(15_000);
}, 30_000);

test('a journey with no clock step runs on real time, so the timer does not fire', async () => {
  let message = '';
  try {
    await run([open('/'), see(text('The minute passed'), { within: 500 })]);
  } catch (error) {
    message = error instanceof Error ? error.message : String(error);
  }
  // The step that waits for the text is the one that fails, and for that reason.
  expect(message).toContain('toBeVisible');
  expect(message).toContain('The minute passed');
}, 30_000);
