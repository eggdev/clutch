import path from 'node:path';

import { defineConfig, devices } from '@playwright/test';
import type { Project } from '@playwright/test';
import { webDevices } from '@tools/journeys/journeys';

type Device = (typeof webDevices)[number];

/**
 * The browser settings of each device, at the viewport that `webDevices` names
 * from docs/principles/mobile-first.md. The journeys run in Chromium, so the
 * phone and the tablet send a Chrome on Android user agent: a phone that
 * emulates touch and a 3x screen, and a tablet with touch and a 2x screen.
 */
const settings: Record<Device['name'], NonNullable<Project['use']>> = {
  Phone: {
    userAgent: devices['Pixel 7'].userAgent,
    deviceScaleFactor: 3,
    isMobile: true,
    hasTouch: true,
    defaultBrowserType: 'chromium',
  },
  Tablet: {
    userAgent: devices['Galaxy Tab S9'].userAgent,
    deviceScaleFactor: 2,
    isMobile: true,
    hasTouch: true,
    defaultBrowserType: 'chromium',
  },
  Desktop: devices['Desktop Chrome'],
};

const use = (device: Device) => ({
  ...settings[device.name],
  viewport: { ...device.viewport },
  screen: { ...device.viewport },
});

/**
 * The Playwright config for web journeys. Run a journey through
 * `mise exec -- bun run journey <id>`, which sets the base URL, the time
 * budget and the quality budgets. Each journey runs on each device in
 * `webDevices`, with one worker. A failed journey runs once more: the runner
 * files a pass on the retry as a flake. The nightly flake hunt passes
 * `--retries 0` and `--repeat-each` on the command line, and names a JSON
 * report in `JOURNEY_REPORT`. See docs/contributing/end-to-end-testing.md#devices.
 */
export default defineConfig({
  testDir: path.resolve(import.meta.dirname, '../../features'),
  testMatch: ['*/journeys/*.pw.ts', '*/journeys/*.journey.ts'],
  outputDir: path.resolve(import.meta.dirname, '../../test-results/journeys'),
  fullyParallel: false,
  workers: 1,
  retries: 1,
  forbidOnly: true,
  // `snap` in @repo/journeys/testing/visual compares with these baselines in
  // CI. A missing baseline fails, so `visual pull` adds it from the CI shots.
  snapshotPathTemplate: '{testDir}/{testFileDir}/__screenshots__/{arg}{ext}',
  updateSnapshots: 'none',
  reporter: process.env.JOURNEY_REPORT
    ? [['list'], ['json', { outputFile: process.env.JOURNEY_REPORT }]]
    : 'list',
  timeout: Number(process.env.JOURNEY_BUDGET_MS ?? 60_000),
  expect: { timeout: 10_000 },
  use: {
    baseURL: process.env.JOURNEY_BASE_URL,
    trace: 'retain-on-failure',
    // The same text and dates on every machine, for the screenshots.
    locale: 'en-US',
    timezoneId: 'UTC',
  },
  projects: webDevices.map((device) => ({
    name: device.name,
    use: use(device),
    metadata: { width: device.width },
  })),
});
