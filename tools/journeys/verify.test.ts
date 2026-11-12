import { expect, test } from 'bun:test';

import { reportOf } from '@tools/journeys/verify';
import type { MeasuredJourney, MeasuredRun } from '@tools/journeys/verify';

const clean = { asShown: [], largestText: [] };

const passing = (device: string): MeasuredRun => ({
  device,
  result: 'passed',
  attempts: [{ retry: 0, outcomes: [], screen: clean }],
});

test('every journey passed with no screen finding ends with the clean line and exits 0', () => {
  const report = reportOf(
    [{ journey: 'notes-sync', runs: [passing('Phone'), passing('Desktop')] }],
    0,
  );
  expect(report.exitCode).toBe(0);
  expect(report.text).toContain(
    '  Phone: passed\n    As shown: none\n    At the largest text size: none',
  );
  expect(report.text.split('\n').at(-1)).toBe('Done: each journey passed, with no screen finding.');
});

test('one failed journey exits 1, names the failure, and counts it in the last line', () => {
  const failed: MeasuredRun = {
    device: 'Tablet',
    result: 'failed',
    attempts: [
      {
        retry: 0,
        screen: null,
        failure: { kind: 'layout-shift', message: 'The layout shift on / is 0.2.' },
      },
    ],
  };
  const journeys: Array<MeasuredJourney> = [
    { journey: 'notes-sync', runs: [passing('Phone'), failed] },
  ];
  const report = reportOf(journeys, 1);
  expect(report.exitCode).toBe(1);
  expect(report.text).toContain('  Tablet: failed (layout-shift): The layout shift on / is 0.2.');
  expect(report.text).toContain('    Screen: not recorded');
  expect(report.text.split('\n').at(-1)).toBe(
    'Done: 1 of 1 journey failed, with 0 screen findings.',
  );
});

test('a passed journey with screen findings exits 0, lists each finding, and counts them', () => {
  const findings: MeasuredRun = {
    device: 'Phone',
    result: 'passed',
    attempts: [
      {
        retry: 0,
        outcomes: [{ name: 'signed-in' }],
        screen: {
          asShown: ['<p> "Hi" extends past the right edge of the window.'],
          largestText: [
            'The page scrolls sideways: its width is 571 px and the window is 390 px.',
            '<button> "Create" extends past the right edge of the window.',
          ],
        },
      },
    ],
  };
  const report = reportOf([{ journey: 'notes-sync', runs: [findings] }], 0);
  expect(report.exitCode).toBe(0);
  expect(report.text).toContain('    Outcomes: signed-in');
  expect(report.text).toContain(
    '    As shown: 1 finding\n      - <p> "Hi" extends past the right edge of the window.',
  );
  expect(report.text).toContain('    At the largest text size: 2 findings');
  expect(report.text.split('\n').at(-1)).toBe(
    'Done: 0 of 1 journey failed, with 3 screen findings.',
  );
});

test('a runner that exits 1 with every measure clean still exits 1 and says so', () => {
  const report = reportOf([{ journey: 'notes-sync', runs: [passing('Phone')] }], 1);
  expect(report.exitCode).toBe(1);
  expect(report.text).toContain('The runner exited with code 1. Read its output above.');
  expect(report.text.split('\n').at(-1)).toBe(
    'Done: 0 of 1 journey failed, with 0 screen findings.',
  );
});

test('the report says that no device ran, for each native app of the repository', () => {
  const report = reportOf([{ journey: 'notes-sync', runs: [passing('Phone')] }], 0, ['app']);
  expect(report.text).toContain(
    'Native: not run. This report holds the web runs only, and apps/app also runs on a device.',
  );
  expect(report.exitCode).toBe(0);
  expect(reportOf([], 0).text).not.toContain('Native:');
});
