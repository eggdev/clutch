import { expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import path from 'node:path';

import { budgetsOf, deviceRuns, reportFlakes, writeMeasures } from '@tools/journeys/measures';
import type { Attempt } from '@tools/journeys/measures';
import { inRepo } from '@tools/testing/in-repo';

const journey = {
  id: 'sign-up',
  feature: 'account',
  file: 'features/account/journeys/sign-up.pw.ts',
  platform: 'web' as const,
};

const attempt = (device: string, retry: number, status: Attempt['status']): Attempt => ({
  device,
  retry,
  status,
  durationMs: 1000,
});

test('a pass on the retry is flaky, a pass on the first try passes, and a failed retry fails', () => {
  const runs = deviceRuns('web', [
    attempt('Pixel 7', 1, 'passed'),
    attempt('Pixel 7', 0, 'failed'),
    attempt('Desktop Chrome', 0, 'passed'),
  ]);
  expect(runs.map(({ device, result }) => ({ device, result }))).toEqual([
    { device: 'Pixel 7', result: 'flaky' },
    { device: 'Desktop Chrome', result: 'passed' },
  ]);
  expect(runs[0]?.attempts.map((item) => item.retry)).toEqual([0, 1]);
  const failed = deviceRuns('ios', [
    attempt('iPhone 16', 0, 'failed'),
    attempt('iPhone 16', 1, 'failed'),
  ]);
  expect(failed[0]?.result).toBe('failed');
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
    const web = writeMeasures(root, journey, deviceRuns('web', [attempt('Pixel 7', 0, 'passed')]));
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
          device: 'Pixel 7',
          result: 'passed',
          attempts: [attempt('Pixel 7', 0, 'passed')],
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
