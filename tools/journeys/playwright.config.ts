import path from 'node:path';

import { defineConfig, devices } from '@playwright/test';

/**
 * The Playwright config for web journeys. Run a journey through
 * `mise exec -- bun run journey <id>`, which sets the base URL and the budget.
 * One worker, and no retries: a journey that fails on an assertion fails. See
 * docs/contributing/setup/verification.md#journeys.
 */
export default defineConfig({
  testDir: path.resolve(import.meta.dirname, '../../features'),
  testMatch: '*/journeys/*.pw.ts',
  outputDir: path.resolve(import.meta.dirname, '../../test-results/journeys'),
  fullyParallel: false,
  workers: 1,
  retries: 0,
  forbidOnly: true,
  // `snap` in @repo/journeys/testing/visual compares with these baselines in
  // CI. A missing baseline fails, so `visual pull` adds it from the CI shots.
  snapshotPathTemplate: '{testDir}/{testFileDir}/__screenshots__/{arg}{ext}',
  updateSnapshots: 'none',
  reporter: 'list',
  timeout: Number(process.env.JOURNEY_BUDGET_MS ?? 60_000),
  expect: { timeout: 10_000 },
  use: {
    ...devices['Desktop Chrome'],
    baseURL: process.env.JOURNEY_BASE_URL,
    trace: 'retain-on-failure',
    // The same text and dates on every machine, for the screenshots.
    locale: 'en-US',
    timezoneId: 'UTC',
  },
});
