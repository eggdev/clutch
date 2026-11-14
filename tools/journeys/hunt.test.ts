import { expect, test } from 'bun:test';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { countFirstRuns, hunt, huntLines, huntSummary, huntWarnings } from '@tools/journeys/hunt';
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

type Status = Report['suites'][number] extends { specs?: Array<{ tests: Array<infer Test> }> }
  ? Test extends { results: Array<{ status: infer Value }> }
    ? Value
    : never
  : never;

/** One repeat of a test on one device, as the JSON report writes it. */
const run = (projectName: string, ...statuses: Array<Status>) => ({
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
  expect(huntWarnings(counts, 20)[1]).toStartWith(
    '::warning title=Journey did not run::pay-invoice',
  );
  expect(huntSummary(counts, devices, 20, [])).toContain(
    'The hunt did not measure `pay-invoice` on each device.',
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

/** Runs `hunt` in a scratch repository, with a Playwright that writes the report that `write` makes. */
async function huntWith(write: (scratch: string) => Report | undefined) {
  const scratch = mkdtempSync(path.join(tmpdir(), 'hunt-'));
  const errors: Array<string> = [];
  try {
    const code = await hunt(
      scratch,
      [notes],
      1,
      { env: {}, log: () => {}, error: (line) => errors.push(line) },
      (env) => {
        const written = write(scratch);
        if (written !== undefined) {
          mkdirSync(path.dirname(env.JOURNEY_REPORT ?? ''), { recursive: true });
          writeFileSync(env.JOURNEY_REPORT ?? '', JSON.stringify(written));
        }
        return Promise.resolve(1);
      },
    );
    return { code, errors };
  } finally {
    rmSync(scratch, { recursive: true, force: true });
  }
}

test('the hunt passes when a journey fails a run, because it only measures', async () => {
  const result = await huntWith((scratch) => ({
    config: { rootDir: path.join(scratch, 'features') },
    suites: [
      {
        file: 'notes/journeys/notes-sync.journey.ts',
        specs: [
          { tests: [run('Phone', 'failed'), run('Tablet', 'passed'), run('Desktop', 'passed')] },
        ],
      },
    ],
  }));
  expect(result).toEqual({ code: 0, errors: [] });
});

test('the hunt fails when Playwright wrote no report', async () => {
  const result = await huntWith(() => {});
  expect(result.code).toBe(1);
  expect(result.errors[0]).toContain('wrote no report');
});

test('the hunt fails when a journey file did not load, so nothing ran', async () => {
  const result = await huntWith((scratch) => ({
    config: { rootDir: path.join(scratch, 'features') },
    suites: [],
    errors: [{ message: 'Cannot find module ./missing' }],
  }));
  expect(result.code).toBe(1);
  expect(result.errors.at(-1)).toContain('1 error(s) outside the journeys');
  expect(result.errors.at(-1)).toContain('1 journey(s) with no run');
});
