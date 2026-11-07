import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';

import type { Journey } from '@tools/journeys/journeys';
import { parse } from 'yaml';

/**
 * The measures file of each journey: `test-results/journeys/measures/<id>.json`
 * for web, and `<id>.<ios|android>.json` for native. It holds the result and
 * the measures of each try on each device: layout shift, clicks and keys, axe
 * results, outcomes and timings. The council review (CL-446) reads it. See
 * docs/contributing/end-to-end-testing.md#measures.
 */

export type Platform = 'web' | 'ios' | 'android';

/**
 * The failures that a retry does not cover, as `budgetFailures` of
 * `@repo/journeys/testing/measure` names them. Production code may not import
 * a `testing/` folder, so the test compares the two sets.
 */
export const budgetFailures: ReadonlySet<string> = new Set(['layout-shift', 'click-budget', 'axe']);

/** What failed a web try, as `@repo/journeys/testing/measure` writes it. */
type Failure = { kind: string; message: string };

/** One try of a journey on one device. A web try also has the measures that `@repo/journeys/testing/measure` writes. */
export type Attempt = {
  device: string;
  retry: number;
  status: 'passed' | 'failed';
  durationMs: number;
  outcomes?: Array<{ name: string }>;
  /** What failed a web try: a budget (`layout-shift`, `click-budget`, `axe`), or a `crash`, `timeout` or `assertion`. */
  failure?: Failure | null;
  [measure: string]: unknown;
};

export type DeviceRun = {
  platform: Platform;
  device: string;
  /**
   * `flaky` is a pass on a retry. `failed` is a last try that failed, or any
   * try that failed a measured budget.
   */
  result: 'passed' | 'failed' | 'flaky';
  /** The try that failed a measured budget, when one did. */
  budgetFailure?: Failure & { retry: number };
  attempts: Array<Attempt>;
};

type Measures = {
  schemaVersion: 1;
  journey: string;
  file: string;
  runs: Array<DeviceRun>;
};

/** Where the measures files of the latest run are. */
const measuresDir = (root: string) => path.join(root, 'test-results/journeys/measures');

/**
 * The device runs of a list of tries: the tries of each device in order, and
 * their result. A pass on a try with `retry > 0` is flaky, even when the first
 * try wrote no file. A try that failed a measured budget fails the run, since
 * a retry that passes does not remove what the first try measured.
 */
export function deviceRuns(platform: Platform, attempts: ReadonlyArray<Attempt>): Array<DeviceRun> {
  const byDevice = Map.groupBy(attempts, (attempt) => attempt.device);
  return [...byDevice.entries()].map(([device, list]) => {
    const tries = list.toSorted((a, b) => a.retry - b.retry);
    const last = tries.at(-1);
    const budget = tries.find((item) => item.failure && budgetFailures.has(item.failure.kind));
    let result: DeviceRun['result'] = 'failed';
    if (budget === undefined && last?.status === 'passed') {
      result = last.retry > 0 ? 'flaky' : 'passed';
    }
    const run: DeviceRun = { platform, device, result, attempts: tries };
    if (budget?.failure) {
      run.budgetFailure = { retry: budget.retry, ...budget.failure };
    }
    return run;
  });
}

/** One line for each device run that failed, so the log says why a run whose retry passed still fails. */
export function failedRuns(journey: Journey, runs: ReadonlyArray<DeviceRun>, where: string) {
  return runs
    .filter((run) => run.result === 'failed')
    .map((run) => {
      const budget = run.budgetFailure;
      return budget
        ? `${journey.file} failed its ${budget.kind} budget on ${run.device}, on try ${budget.retry + 1}. A retry does not cover a measured budget. ${budget.message} See ${where}.`
        : `${journey.file} failed on ${run.device}, also on the retry. See ${where}.`;
    });
}

/** The web tries of a journey that the journey test wrote under `dir/<id>/`. */
export function webAttempts(dir: string, journey: Journey): Array<Attempt> {
  const folder = path.join(dir, journey.id);
  if (!existsSync(folder)) {
    return [];
  }
  return readdirSync(folder)
    .filter((name) => name.endsWith('.json'))
    .map((name) => JSON.parse(readFileSync(path.join(folder, name), 'utf-8')) as Attempt);
}

/** Writes the measures file of a journey, and returns its repository path. */
export function writeMeasures(root: string, journey: Journey, runs: Array<DeviceRun>) {
  const native = runs.find((run) => run.platform !== 'web')?.platform;
  const name = native ? `${journey.id}.${native}.json` : `${journey.id}.json`;
  const measures: Measures = {
    schemaVersion: 1,
    journey: journey.id,
    file: journey.file,
    runs,
  };
  mkdirSync(measuresDir(root), { recursive: true });
  const file = path.join(measuresDir(root), name);
  writeFileSync(file, `${JSON.stringify(measures, null, 2)}\n`);
  return path.relative(root, file);
}

/** Files a `flake` friction entry. The CLI runs `clutch friction add`. */
export type FileFlake = (text: string) => Promise<void>;

export const frictionFlake =
  (root: string): FileFlake =>
  async (text) => {
    const proc = Bun.spawn(
      [process.execPath, 'tools/clutch.ts', 'friction', 'add', text, '--kind', 'flake'],
      { cwd: root, stdout: 'inherit', stderr: 'inherit' },
    );
    await proc.exited;
  };

/**
 * Reports each device run that passed on the retry: a friction entry with the
 * journey and the platform, and a warning annotation in GitHub Actions. The
 * check still passes.
 */
export async function reportFlakes(
  journey: Journey,
  runs: ReadonlyArray<DeviceRun>,
  where: string,
  fileFlake: FileFlake,
  log: (line: string) => void,
) {
  for (const run of runs.filter((item) => item.result === 'flaky')) {
    const text = `Journey ${journey.id} failed, then passed on the retry, on ${run.platform} (${run.device}). See ${where}.`;
    log(`::warning title=Flaky journey::${text}`);
    await fileFlake(text);
  }
}

/**
 * The quality budgets in `budgets:` of clutch.yaml, as the journey test reads
 * them from `JOURNEY_BUDGETS`. `clutch doctor` checks their shape. A value of
 * the wrong type fails here, so a run never uses a budget that it misread.
 */
export function budgetsOf(
  root: string,
): { layoutShift?: number; clicks?: Record<string, number> } | string {
  const file = path.join(root, 'clutch.yaml');
  const data = existsSync(file)
    ? (parse(readFileSync(file, 'utf-8')) as {
        budgets?: Record<string, unknown>;
      } | null)
    : null;
  const { layoutShift, clicks } = data?.budgets ?? {};
  const counts = Object.values(clicks ?? {});
  if (
    (layoutShift !== undefined && typeof layoutShift !== 'number') ||
    (clicks !== undefined && (typeof clicks !== 'object' || clicks === null)) ||
    counts.some((count) => !Number.isInteger(count))
  ) {
    return '`budgets:` in clutch.yaml is not valid. Run `mise exec -- bun run clutch doctor` and fix what it names.';
  }
  return {
    ...(layoutShift === undefined ? {} : { layoutShift }),
    ...(clicks === undefined ? {} : { clicks: clicks as Record<string, number> }),
  };
}
