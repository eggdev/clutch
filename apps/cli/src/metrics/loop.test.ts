import { expect, test } from 'bun:test';

import { loopMetrics, loopRuns, spreadSample, stepRunsToRead, stepSample } from '@/metrics/loop';
import type { LoopRun } from '@/metrics/loop';

const since = '2026-10-01T00:00:00.000Z';

/** A run that took `minutes`, created on the `start` day. */
function run(id: number, event: string, start: string, minutes: number, conclusion = 'success') {
  return {
    id,
    event,
    conclusion,
    createdAt: start,
    runStartedAt: start,
    updatedAt: new Date(Date.parse(start) + minutes * 60_000).toISOString(),
  } satisfies LoopRun;
}

test('a sample keeps the first and the last item and spreads the rest evenly', () => {
  const items = Array.from({ length: 100 }, (_, index) => index);
  expect(spreadSample(items, 5)).toEqual([0, 25, 50, 74, 99]);
  expect(spreadSample(items.slice(0, 3), 5)).toEqual([0, 1, 2]);
});

test('each median is compared with the period before, and a rise over 20% is marked', () => {
  // In September (the period before), main took 2 min; in October it took 3 min.
  const runs = loopRuns(
    [
      run(1, 'push', '2026-09-20T00:00:00Z', 2),
      run(2, 'push', '2026-10-02T00:00:00Z', 3),
      run(3, 'push', '2026-10-03T00:00:00Z', 3),
      run(4, 'pull_request', '2026-10-02T00:00:00Z', 1),
      // A failed run stops early, so it does not count.
      run(5, 'pull_request', '2026-10-03T00:00:00Z', 0.1, 'failure'),
    ],
    since,
  );
  const steps = new Map([
    [1, 60],
    [2, 66],
    [3, 66],
    [4, 50],
  ]);
  const loop = loopMetrics(runs, steps);
  expect(loop).toMatchObject({
    workflow: 'ci.yml',
    step: 'validate',
    riseLimit: 0.2,
    push: {
      runSeconds: {
        p50: 180,
        count: 2,
        previousP50: 120,
        previousCount: 1,
        change: 0.5,
        rise: true,
      },
      validateSeconds: { p50: 66, previousP50: 60, change: 0.1, rise: false },
    },
    pullRequest: {
      runSeconds: { p50: 60, count: 1, previousP50: null, change: null, rise: false },
      validateSeconds: { p50: 50, count: 1 },
    },
  });
});

test('the step times are read for at most a sample of runs of each event and period', () => {
  const many = Array.from({ length: 200 }, (_, index) =>
    run(index, 'pull_request', '2026-10-02T00:00:00Z', 1),
  );
  const read = stepRunsToRead(loopRuns(many, since));
  expect(read).toHaveLength(stepSample);
  expect(read[0].id).toBe(0);
  expect(read.at(-1)?.id).toBe(199);
});
