import { percentile } from '@/metrics/compute';

/**
 * The agent loop's times in CI: the `validate` step of the `validate` job in
 * `.github/workflows/ci.yml`, and the whole CI run. Time is reported and never
 * blocks. Only a count blocks, because a count cannot fail on a slow machine.
 * See docs/contributing/setup/checks.md.
 */
export const loopSource = { workflow: 'ci.yml', job: 'validate', step: 'validate' } as const;

/**
 * The names the step had. Before 2026-10-30 it had no `name:`, so GitHub named
 * it after its command. The old name keeps the period before readable.
 */
export const stepNames = new Set<string>([loopSource.step, 'Run bun run validate']);

/** A median that rose by more than this share against the period before is marked. */
export const riseLimit = 0.2;

/**
 * The step times read for each event in each period, at most. Each one costs a
 * `jobs` request, and a period can hold hundreds of runs, so the runs to read
 * are spread evenly over the period.
 */
export const stepSample = 40;

/** One run of the CI workflow, as `actions/workflows/ci.yml/runs` reports it. */
export type LoopRun = {
  id: number;
  event: string;
  conclusion: string | null;
  createdAt: string;
  runStartedAt: string;
  updatedAt: string;
};

/** The events that the report splits: a PR runs `validate --changed`, a push to main runs the full `validate`. */
const events = { pullRequest: 'pull_request', push: 'push' } as const;
type EventKey = keyof typeof events;

const seconds = (from: string, to: string) => (Date.parse(to) - Date.parse(from)) / 1000;

/** At most `max` of `items`, spread evenly from the first to the last. */
export function spreadSample<T>(items: Array<T>, max: number): Array<T> {
  if (items.length <= max) {
    return items;
  }
  if (max <= 1) {
    return items.slice(0, max);
  }
  const step = (items.length - 1) / (max - 1);
  return Array.from({ length: max }, (_, index) => items[Math.round(index * step)]);
}

/**
 * The successful runs of each event in each period, oldest first. A failed or
 * cancelled run stops early, so its time says nothing about the loop.
 */
export function loopRuns(runs: Array<LoopRun>, since: string) {
  const passed = runs
    .filter((run) => run.conclusion === 'success')
    .toSorted((a, b) => a.createdAt.localeCompare(b.createdAt));
  const split = (event: string) => {
    const mine = passed.filter((run) => run.event === event);
    return {
      current: mine.filter((run) => run.createdAt >= since),
      previous: mine.filter((run) => run.createdAt < since),
    };
  };
  return { pullRequest: split(events.pullRequest), push: split(events.push) };
}

export type LoopRuns = ReturnType<typeof loopRuns>;

const runTimes = (list: Array<LoopRun>) =>
  list.map((run) => seconds(run.runStartedAt, run.updatedAt));

/** The median of a period against the period before, and whether it rose past `riseLimit`. */
function trend(current: Array<number>, previous: Array<number>) {
  const p50 = percentile(current, 50);
  const previousP50 = percentile(previous, 50);
  const change =
    p50 === null || previousP50 === null || previousP50 === 0
      ? null
      : Math.round(((p50 - previousP50) / previousP50) * 1000) / 1000;
  return {
    p50,
    count: current.length,
    previousP50,
    previousCount: previous.length,
    change,
    rise: change !== null && change > riseLimit,
  };
}

export type LoopTrend = ReturnType<typeof trend>;

/**
 * The loop times in seconds. `stepSeconds` maps a run id to the time of its
 * `validate` step, for the runs whose step was read and passed.
 */
export function loopMetrics(runs: LoopRuns, stepSeconds: Map<number, number>) {
  const stepTimes = (list: Array<LoopRun>) =>
    list.map((run) => stepSeconds.get(run.id)).filter((time) => time !== undefined);
  const of = (key: EventKey) => ({
    validateSeconds: trend(stepTimes(runs[key].current), stepTimes(runs[key].previous)),
    runSeconds: trend(runTimes(runs[key].current), runTimes(runs[key].previous)),
  });
  return {
    ...loopSource,
    riseLimit,
    pullRequest: of('pullRequest'),
    push: of('push'),
  };
}

export type LoopMetrics = ReturnType<typeof loopMetrics>;

/** The runs whose step time to read: up to `stepSample` per event and period. */
export function stepRunsToRead(runs: LoopRuns) {
  return [runs.pullRequest, runs.push].flatMap((byPeriod) => [
    ...spreadSample(byPeriod.current, stepSample),
    ...spreadSample(byPeriod.previous, stepSample),
  ]);
}

/** The name of each row and the trend it shows, in the order of the report. */
export function loopRows(loop: LoopMetrics): Array<[string, LoopTrend]> {
  return [
    ['Validate step, PRs', loop.pullRequest.validateSeconds],
    ['Validate step, main', loop.push.validateSeconds],
    ['CI run, PRs', loop.pullRequest.runSeconds],
    ['CI run, main', loop.push.runSeconds],
  ];
}
