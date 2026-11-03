import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { bunTests, excludePattern, quarantined } from '@tools/flaky';
import type { FlakyTest } from '@tools/flaky';

/**
 * Runs a test command and fails when it takes longer than its budget. A slow
 * suite slows every push. It is often the first sign of a test that reaches the
 * network or builds too much setup.
 *
 * A `bun test` command leaves out each test in the flaky-test quarantine,
 * `tools/flaky-tests.json`. `tools/run-quarantined.ts` runs those on their own.
 *
 * When the budget fails, and with `--report`, it lists the 10 slowest test files
 * and the 10 slowest tests. Bun writes their times to a JUnit report, which the
 * script reads from a temporary file, so the times show locally too.
 *
 * Usage: bun tools/test-budget.ts [--report] <seconds> -- <command...>
 */
export function budgetError(elapsedMs: number, budgetSeconds: number): string | null {
  const elapsed = elapsedMs / 1000;
  if (elapsed <= budgetSeconds) {
    return null;
  }
  return [
    `The tests took ${elapsed.toFixed(1)}s. The budget is ${budgetSeconds}s.`,
    'Make the slowest ones faster: no network, less setup. The slowest files and tests follow.',
    'Never delete or skip a test to fit the budget. Raise the budget only in a reviewed change that says why.',
  ].join('\n');
}

export function parseArgs(args: Array<string>): {
  budgetSeconds: number;
  command: Array<string>;
  report: boolean;
} {
  const report = args[0] === '--report';
  const [seconds, separator, ...command] = report ? args.slice(1) : args;
  const budgetSeconds = Number(seconds);
  if (
    !Number.isFinite(budgetSeconds) ||
    budgetSeconds <= 0 ||
    separator !== '--' ||
    command.length === 0
  ) {
    throw new Error('Usage: bun tools/test-budget.ts [--report] <seconds> -- <command...>');
  }
  return { budgetSeconds, command, report };
}

const isBunTest = (command: Array<string>) => command[0] === 'bun' && command[1] === 'test';

/** `command` with a `-t` pattern that leaves out the quarantined tests, when it is a `bun test` run. */
export function withQuarantine(command: Array<string>, tests: ReadonlyArray<FlakyTest>) {
  const pattern = excludePattern(tests);
  if (!pattern || !isBunTest(command)) {
    return command;
  }
  return [...command, '--test-name-pattern', pattern];
}

/** `command` with a JUnit report written to `junitFile`, when it is a `bun test` run that sets no reporter. */
export function withTimings(command: Array<string>, junitFile: string): Array<string> {
  if (!isBunTest(command) || command.some((arg) => arg.startsWith('--reporter'))) {
    return command;
  }
  return [...command, '--reporter=junit', `--reporter-outfile=${junitFile}`];
}

export type FileTiming = { readonly file: string; readonly seconds: number };
export type TestTiming = { readonly file: string; readonly name: string; readonly seconds: number };
export type Timings = { readonly files: Array<FileTiming>; readonly tests: Array<TestTiming> };

const decode = (text: string) =>
  text
    .replaceAll('&quot;', '"')
    .replaceAll('&apos;', "'")
    .replaceAll('&lt;', '<')
    .replaceAll('&gt;', '>')
    .replaceAll('&amp;', '&');

const attribute = (tag: string, name: string) =>
  decode(new RegExp(`\\s${name}="([^"]*)"`, 'u').exec(tag)?.[1] ?? '');

/**
 * The time of each test in a bun JUnit report, and the total time of each file,
 * which is the sum of its tests. A skipped test has no time. A test in a
 * `describe` block is named with its block: `inner > outer > name`.
 */
export function parseTimings(junit: string): Timings {
  const tests: Array<TestTiming> = [];
  const testcase = /<testcase\b([^>]*?)(\/>|>([\s\S]*?)<\/testcase>)/gu;
  for (const match of junit.matchAll(testcase)) {
    const tag = match[1];
    if ((match[3] ?? '').includes('<skipped')) {
      continue;
    }
    const classname = attribute(tag, 'classname');
    const name = attribute(tag, 'name');
    tests.push({
      file: attribute(tag, 'file'),
      name: classname ? `${classname} > ${name}` : name,
      seconds: Number(attribute(tag, 'time')) || 0,
    });
  }
  const perFile = new Map<string, number>();
  for (const test of tests) {
    perFile.set(test.file, (perFile.get(test.file) ?? 0) + test.seconds);
  }
  const files = [...perFile].map(([file, seconds]) => ({ file, seconds }));
  return { files, tests };
}

const slowest = <T extends { readonly seconds: number }>(items: ReadonlyArray<T>, limit: number) =>
  items.toSorted((a, b) => b.seconds - a.seconds).slice(0, limit);

const seconds = (value: number) => `${value.toFixed(2)}s`;

/** The 10 slowest test files and the 10 slowest tests, slowest first. `null` when the run wrote no times. */
export function timingReport(timings: Timings | null, limit = 10): string {
  if (!timings) {
    return 'No per-test times: the budget reads them from a bun test run.';
  }
  const files = slowest(timings.files, limit).map(
    (file, index) => `  ${index + 1}. ${file.file}  ${seconds(file.seconds)}`,
  );
  const tests = slowest(timings.tests, limit).map(
    (test, index) => `  ${index + 1}. ${test.file} > ${test.name}  ${seconds(test.seconds)}`,
  );
  return [
    `Slowest test files (${files.length}):`,
    ...files,
    '',
    `Slowest tests (${tests.length}):`,
    ...tests,
  ].join('\n');
}

if (import.meta.main) {
  const { budgetSeconds, command: plain, report } = parseArgs(Bun.argv.slice(2));
  const tests = bunTests(quarantined(process.cwd()));
  const quarantine = withQuarantine(plain, tests);
  if (quarantine !== plain) {
    console.log(
      `Quarantined, run by run-quarantined: ${tests.map((test) => test.name).join('; ')}`,
    );
  }
  const dir = mkdtempSync(path.join(tmpdir(), 'test-budget-'));
  const junitFile = path.join(dir, 'junit.xml');
  const command = withTimings(quarantine, junitFile);
  const start = performance.now();
  const run = Bun.spawnSync(command, { stdout: 'inherit', stderr: 'inherit' });
  const elapsed = performance.now() - start;
  const timings =
    command !== quarantine && existsSync(junitFile)
      ? parseTimings(readFileSync(junitFile, 'utf-8'))
      : null;
  rmSync(dir, { recursive: true, force: true });
  const listing = timingReport(timings);
  if (run.exitCode !== 0) {
    if (report) {
      console.log(listing);
    }
    process.exit(run.exitCode ?? 1);
  }
  const error = budgetError(elapsed, budgetSeconds);
  if (error) {
    console.error(`${error}\n\n${listing}`);
    process.exit(1);
  }
  if (report) {
    console.log(listing);
  }
}
