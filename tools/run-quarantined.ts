import { appendFileSync } from 'node:fs';

import { onlyPattern, quarantined } from '@tools/flaky';
import type { FlakyTest } from '@tools/flaky';

/**
 * Runs each quarantined test on its own, up to `attempts` times, and reports
 * how it did. It never fails the build: the quarantine exists so a flaky test
 * cannot block a merge. It writes a table to the GitHub job summary and a
 * warning annotation for a test that failed every attempt. See
 * docs/contributing/testing.md#flaky-tests.
 */
export const attempts = 3;

export type Outcome = { readonly test: FlakyTest; readonly passedOn: number | null };

/** Runs one test up to `attempts` times. `run` returns true when that attempt passed. */
export function retry(
  test: FlakyTest,
  run: (test: FlakyTest) => boolean,
  tries = attempts,
): Outcome {
  for (let attempt = 1; attempt <= tries; attempt += 1) {
    if (run(test)) {
      return { test, passedOn: attempt };
    }
  }
  return { test, passedOn: null };
}

/** The summary table, one row per quarantined test. */
export function report(outcomes: ReadonlyArray<Outcome>): string {
  if (outcomes.length === 0) {
    return 'No test is quarantined.';
  }
  const rows = outcomes.map(({ test, passedOn }) => {
    let result = `failed all ${attempts} attempts`;
    if (passedOn === 1) {
      result = 'passed';
    } else if (passedOn !== null) {
      result = `flaky: passed on attempt ${passedOn}`;
    }
    return `| ${test.file} | ${test.name} | ${test.issue} | ${test.until} | ${result} |`;
  });
  return [
    `## Quarantined tests (non-blocking, up to ${attempts} attempts each)`,
    '',
    '| File | Test | Issue | Until | Result |',
    '| --- | --- | --- | --- | --- |',
    ...rows,
  ].join('\n');
}

const bunRun = (test: FlakyTest) =>
  Bun.spawnSync(['bun', 'test', test.file, '--test-name-pattern', onlyPattern(test)], {
    stdout: 'inherit',
    stderr: 'inherit',
  }).exitCode === 0;

if (import.meta.main) {
  const outcomes = quarantined(process.cwd()).map((test) => retry(test, bunRun));
  const text = report(outcomes);
  console.log(text);
  if (process.env.GITHUB_STEP_SUMMARY) {
    appendFileSync(process.env.GITHUB_STEP_SUMMARY, `${text}\n`);
  }
  for (const { test, passedOn } of outcomes) {
    if (passedOn === null) {
      console.log(
        `::warning file=${test.file},title=Quarantined test failed::"${test.name}" failed ${attempts} times. ${test.issue} owns the fix.`,
      );
    }
  }
}
