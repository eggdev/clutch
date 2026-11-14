import { expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import path from 'node:path';

import { budgetFailures as kitBudgetFailures } from '@repo/journeys/testing/measure';
import {
  budgetFailures,
  budgetsOf,
  deviceRuns,
  failedRuns,
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

test('a pass on the first try passes, and a failed try fails the run, also when a later try passed', () => {
  const runs = deviceRuns('web', [
    attempt('Phone', 1, 'passed'),
    attempt('Phone', 0, 'failed'),
    attempt('Desktop', 0, 'passed'),
  ]);
  expect(runs.map(({ device, result }) => ({ device, result }))).toEqual([
    { device: 'Phone', result: 'failed' },
    { device: 'Desktop', result: 'passed' },
  ]);
  expect(runs[0]?.attempts.map((item) => item.retry)).toEqual([0, 1]);
  const failed = deviceRuns('ios', [attempt('iPhone 16', 0, 'failed')]);
  expect(failed[0]?.result).toBe('failed');
});

test('the runner and the journey kit name the same measured budgets', () => {
  expect([...budgetFailures]).toEqual([...kitBudgetFailures]);
});

test('a failed run names the measured budget that it failed, and a crash names only the device', () => {
  const crash = { kind: 'crash' as const, message: 'page.goto: net::ERR_CONNECTION_RESET' };
  const shift = {
    kind: 'layout-shift' as const,
    message: 'The layout shift on / is 0.2, at or over the budget of 0.01.',
  };
  const runs = deviceRuns('web', [
    attempt('Phone', 0, 'failed', shift),
    attempt('Tablet', 0, 'failed', { kind: 'axe', message: 'axe found violations' }),
    attempt('Desktop', 0, 'failed', crash),
  ]);
  expect(runs.map(({ device, result }) => ({ device, result }))).toEqual([
    { device: 'Phone', result: 'failed' },
    { device: 'Tablet', result: 'failed' },
    { device: 'Desktop', result: 'failed' },
  ]);
  expect(runs[0]?.budgetFailure).toEqual(shift);
  expect(runs[2]?.budgetFailure).toBeUndefined();
  expect(failedRuns(journey, runs, 'sign-up.json')).toEqual([
    'features/account/journeys/sign-up.pw.ts failed its layout-shift budget on Phone. The layout shift on / is 0.2, at or over the budget of 0.01. See sign-up.json.',
    'features/account/journeys/sign-up.pw.ts failed its axe budget on Tablet. axe found violations See sign-up.json.',
    'features/account/journeys/sign-up.pw.ts failed on Desktop. See sign-up.json.',
  ]);
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
