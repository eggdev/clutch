import path from 'node:path';

import { defineConfig, devices } from '@playwright/test';
import { webDevices } from '@tools/journeys/journeys';

/** The browser settings of each device. The laptop is 1280 px wide, like its screenshots. */
const settings: Record<(typeof webDevices)[number]['name'], (typeof devices)[string]> = {
  'Pixel 7': devices['Pixel 7'],
  'Desktop Chrome': {
    ...devices['Desktop Chrome'],
    viewport: { width: 1280, height: 800 },
  },
};

/**
 * The Playwright config for web journeys. Run a journey through
 * `mise exec -- bun run journey <id>`, which sets the base URL, the time
 * budget and the quality budgets. Each journey runs on each device in
 * `webDevices`, with one worker. A failed journey runs once more: the runner
 * files a pass on the retry as a flake. See
 * docs/contributing/end-to-end-testing.md#devices.
 */
export default defineConfig({
  testDir: path.resolve(import.meta.dirname, '../../features'),
  testMatch: '*/journeys/*.pw.ts',
  outputDir: path.resolve(import.meta.dirname, '../../test-results/journeys'),
  fullyParallel: false,
  workers: 1,
  retries: 1,
  forbidOnly: true,
  // `snap` in @repo/journeys/testing/visual compares with these baselines in
  // CI. A missing baseline fails, so `visual pull` adds it from the CI shots.
  snapshotPathTemplate: '{testDir}/{testFileDir}/__screenshots__/{arg}{ext}',
  updateSnapshots: 'none',
  reporter: 'list',
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
    use: settings[device.name],
    metadata: { width: device.width },
  })),
});
