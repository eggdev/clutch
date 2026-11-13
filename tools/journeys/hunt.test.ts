import { expect, test } from 'bun:test';

import { countFirstRuns, huntLines, huntSummary, huntWarnings } from '@tools/journeys/hunt';
import type { Report } from '@tools/journeys/hunt';
import type { Journey } from '@tools/journeys/journeys';

const root = '/repo';
const devices = ['Phone', 'Desktop'];

const notes: Journey = {
  id: 'notes-sync',
  feature: 'notes',
  file: 'features/notes/journeys/notes-sync.journey.ts',
  platform: 'web',
};
const pay: Journey = {
  id: 'pay-invoice',
  feature: 'billing',
  file: 'features/billing/journeys/pay-invoice.pw.ts',
  platform: 'web',
};

/** One repeat of a test on one device, as the JSON report writes it. */
const run = (projectName: string, ...statuses: Array<string>) => ({
  projectName,
  results: statuses.map((status, retry) => ({ status, retry })),
});

const report: Report = {
  config: { rootDir: '/repo/features' },
  suites: [
    {
      file: 'notes/journeys/notes-sync.journey.ts',
      specs: [
        {
          tests: [
            run('Phone', 'passed'),
            run('Phone', 'failed'),
            run('Phone', 'timedOut'),
            run('Desktop', 'passed'),
            run('Desktop', 'skipped'),
          ],
        },
      ],
      suites: [{ specs: [{ tests: [run('Desktop', 'failed', 'passed')] }] }],
    },
    { file: 'other/journeys/gone.pw.ts', specs: [{ tests: [run('Phone', 'failed')] }] },
  ],
};

test('counts the first-run failures of each journey on each device', () => {
  const counts = countFirstRuns(root, report, [notes, pay], devices);
  expect(counts).toEqual([
    {
      journey: notes,
      devices: [
        { device: 'Phone', runs: 3, failed: 2 },
        { device: 'Desktop', runs: 2, failed: 1 },
      ],
    },
    {
      journey: pay,
      devices: [
        { device: 'Phone', runs: 0, failed: 0 },
        { device: 'Desktop', runs: 0, failed: 0 },
      ],
    },
  ]);
});

test('names each journey with its count on each device, and says when one did not run', () => {
  const counts = countFirstRuns(root, report, [notes, pay], devices);
  expect(huntLines(counts)).toEqual([
    'notes-sync: Phone 2 of 3, Desktop 1 of 2',
    'pay-invoice: Phone no run, Desktop no run',
  ]);
  expect(huntWarnings(counts, 20)).toHaveLength(2);
  expect(huntWarnings(counts, 20)[0]).toStartWith(
    '::warning title=Journey failed a first run::notes-sync',
  );
});

test('the step summary has a row for each journey and a column for each device', () => {
  const counts = countFirstRuns(root, report, [notes], devices);
  const summary = huntSummary(counts, devices, 20, ['A file did not load.\nat line 3']);
  expect(summary).toContain('| Journey | Phone | Desktop |');
  expect(summary).toContain('| `notes-sync` | 2 of 3 | 1 of 2 |');
  expect(summary).toContain('1 journey(s) failed a first run.');
  expect(summary).toContain('- A file did not load.');
  expect(summary).not.toContain('at line 3');
});

test('a clean hunt says that no journey failed', () => {
  const clean: Report = {
    config: { rootDir: '/repo/features' },
    suites: [
      {
        file: 'notes/journeys/notes-sync.journey.ts',
        specs: [{ tests: [run('Phone', 'passed'), run('Desktop', 'passed')] }],
      },
    ],
  };
  const counts = countFirstRuns(root, clean, [notes], devices);
  expect(huntWarnings(counts, 1)).toEqual([]);
  expect(huntSummary(counts, devices, 1, [])).toContain('No journey failed a first run.');
});
