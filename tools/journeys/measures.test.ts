import { expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import path from 'node:path';

import { budgetFailures as kitBudgetFailures } from '@repo/journeys/testing/measure';
import {
  budgetFailures,
  budgetsOf,
  deviceRuns,
  failedRuns,
  reportFlakes,
  writeMeasures,
} from '@tools/journeys/measures';
import type { Attempt } from '@tools/journeys/measures';
import { inRepo } from '@tools/testing/in-repo';

const journey = {
  id: 'sign-up',
  feature: 'account',
  file: 'features/account/journeys/sign-up.pw.ts',
  platform: 'web' as const,
};

const attempt = (
  device: string,
  retry: number,
  status: Attempt['status'],
  failure?: Attempt['failure'],
): Attempt => ({
  device,
  retry,
  status,
  durationMs: 1000,
  ...(failure === undefined ? {} : { failure }),
});

test('a pass on the retry is flaky, a pass on the first try passes, and a failed retry fails', () => {
  const runs = deviceRuns('web', [
    attempt('Phone', 1, 'passed'),
    attempt('Phone', 0, 'failed'),
    attempt('Desktop', 0, 'passed'),
  ]);
  expect(runs.map(({ device, result }) => ({ device, result }))).toEqual([
    { device: 'Phone', result: 'flaky' },
    { device: 'Desktop', result: 'passed' },
  ]);
  expect(runs[0]?.attempts.map((item) => item.retry)).toEqual([0, 1]);
  const failed = deviceRuns('ios', [
    attempt('iPhone 16', 0, 'failed'),
    attempt('iPhone 16', 1, 'failed'),
  ]);
  expect(failed[0]?.result).toBe('failed');
});

test('the runner and the journey kit name the same measured budgets', () => {
  expect([...budgetFailures]).toEqual([...kitBudgetFailures]);
});

test('a pass on the retry is flaky by its retry index, also when the first try wrote no file', () => {
  const [run] = deviceRuns('web', [attempt('Phone', 1, 'passed')]);
  expect(run?.result).toBe('flaky');
});

test('a measured budget that fails on the first try fails the run, though the retry passes', () => {
  const crash = { kind: 'crash' as const, message: 'page.goto: net::ERR_CONNECTION_RESET' };
  const shift = {
    kind: 'layout-shift' as const,
    message: 'The layout shift on / is 0.2, at or over the budget of 0.01.',
  };
  const runs = deviceRuns('web', [
    attempt('Phone', 0, 'failed', shift),
    attempt('Phone', 1, 'passed', null),
    attempt('Tablet', 0, 'failed', { kind: 'axe', message: 'axe found violations' }),
    attempt('Tablet', 1, 'passed', null),
    attempt('Desktop', 0, 'failed', crash),
    attempt('Desktop', 1, 'passed', null),
  ]);
  expect(runs.map(({ device, result }) => ({ device, result }))).toEqual([
    { device: 'Phone', result: 'failed' },
    { device: 'Tablet', result: 'failed' },
    { device: 'Desktop', result: 'flaky' },
  ]);
  expect(runs[0]?.budgetFailure).toEqual({ retry: 0, ...shift });
  expect(failedRuns(journey, runs, 'sign-up.json')).toEqual([
    'features/account/journeys/sign-up.pw.ts failed its layout-shift budget on Phone, on try 1. A retry does not cover a measured budget. The layout shift on / is 0.2, at or over the budget of 0.01. See sign-up.json.',
    'features/account/journeys/sign-up.pw.ts failed its axe budget on Tablet, on try 1. A retry does not cover a measured budget. axe found violations See sign-up.json.',
  ]);
});

test('a flaky run files a flake friction entry with the journey and the platform, and warns', async () => {
  const filed: Array<string> = [];
  const lines: Array<string> = [];
  const runs = deviceRuns('android', [
    attempt('pixel-7-api-35', 0, 'failed'),
    attempt('pixel-7-api-35', 1, 'passed'),
  ]);
  await reportFlakes(
    journey,
    runs,
    'test-results/journeys/measures/sign-up.android.json',
    (text) => {
      filed.push(text);
      return Promise.resolve();
    },
    (line) => lines.push(line),
  );
  const text =
    'Journey sign-up failed, then passed on the retry, on android (pixel-7-api-35). See test-results/journeys/measures/sign-up.android.json.';
  expect(filed).toEqual([text]);
  expect(lines).toEqual([`::warning title=Flaky journey::${text}`]);
});

test('each journey writes one measures file, and a native one names its platform', async () => {
  await inRepo({}, (root) => {
    const web = writeMeasures(root, journey, deviceRuns('web', [attempt('Phone', 0, 'passed')]));
    const ios = writeMeasures(
      root,
      journey,
      deviceRuns('ios', [attempt('iPhone 16', 0, 'passed')]),
    );
    expect([web, ios]).toEqual([
      'test-results/journeys/measures/sign-up.json',
      'test-results/journeys/measures/sign-up.ios.json',
    ]);
    expect(JSON.parse(readFileSync(path.join(root, web), 'utf-8'))).toEqual({
      schemaVersion: 1,
      journey: 'sign-up',
      file: 'features/account/journeys/sign-up.pw.ts',
      runs: [
        {
          platform: 'web',
          device: 'Phone',
          result: 'passed',
          attempts: [attempt('Phone', 0, 'passed')],
        },
      ],
    });
  });
});

const yaml = (budgets: string) => ({ 'clutch.yaml': `schemaVersion: 1\nbudgets:\n${budgets}` });

test('the budgets come from clutch.yaml, and a budget of the wrong type fails the run', async () => {
  expect(await inRepo({}, budgetsOf)).toEqual({});
  expect(await inRepo(yaml('  layoutShift: 0.02\n  clicks: { sign-up: 4 }\n'), budgetsOf)).toEqual({
    layoutShift: 0.02,
    clicks: { 'sign-up': 4 },
  });
  expect(await inRepo(yaml("  layoutShift: '0.02'\n"), budgetsOf)).toBe(
    '`budgets:` in clutch.yaml is not valid. Run `mise exec -- bun run clutch doctor` and fix what it names.',
  );
});
