import { expect, test } from 'bun:test';
import path from 'node:path';

import {
  budgetError,
  parseArgs,
  parseTimings,
  timingReport,
  withQuarantine,
  withTimings,
} from '@tools/test-budget';
import { inRepo } from '@tools/testing/in-repo';

test('the budget passes at the limit and fails past it with a fix hint', () => {
  expect(budgetError(60_000, 60)).toBeNull();
  expect(budgetError(61_500, 60)).toStartWith('The tests took 61.5s. The budget is 60s.');
  expect(budgetError(61_500, 60)).toContain('Never delete or skip a test');
});

test('the arguments need a positive budget, a separator and a command', () => {
  expect(parseArgs(['60', '--', 'bun', 'test'])).toEqual({
    budgetSeconds: 60,
    command: ['bun', 'test'],
    report: false,
  });
  expect(parseArgs(['--report', '60', '--', 'bun', 'test'])).toEqual({
    budgetSeconds: 60,
    command: ['bun', 'test'],
    report: true,
  });
  expect(() => parseArgs(['0', '--', 'bun'])).toThrow('Usage');
  expect(() => parseArgs(['60', 'bun', 'test'])).toThrow('Usage');
  expect(() => parseArgs(['60', '--'])).toThrow('Usage');
});

test('a bun test run leaves out the quarantined tests, and any other command is unchanged', () => {
  const flaky = [
    {
      file: 'tools/a.test.ts',
      name: 'slow one',
      issue: 'CL-128',
      until: '2026-11-20',
      reason: 'x',
    },
  ];
  expect(withQuarantine(['bun', 'test', 'tools'], flaky)).toEqual([
    'bun',
    'test',
    'tools',
    '--test-name-pattern',
    '^(?!(?:.* )?(?:slow one)$)',
  ]);
  expect(withQuarantine(['bun', 'test', 'tools'], [])).toEqual(['bun', 'test', 'tools']);
  expect(withQuarantine(['python3', 'tools/run-skill-tests.py'], flaky)).toEqual([
    'python3',
    'tools/run-skill-tests.py',
  ]);
});

test('a bun test run writes a JUnit report of its times, unless it sets a reporter', () => {
  expect(withTimings(['bun', 'test', 'tools'], '/tmp/j.xml')).toEqual([
    'bun',
    'test',
    'tools',
    '--reporter=junit',
    '--reporter-outfile=/tmp/j.xml',
  ]);
  expect(withTimings(['bun', 'test', '--reporter=dots'], '/tmp/j.xml')).toEqual([
    'bun',
    'test',
    '--reporter=dots',
  ]);
  expect(withTimings(['python3', 'tools/run-skill-tests.py'], '/tmp/j.xml')).toEqual([
    'python3',
    'tools/run-skill-tests.py',
  ]);
});

/** A JUnit report with 12 tests in 3 files. The nested `describe` block is escaped as XML. */
const sampleJUnit = `<?xml version="1.0" encoding="UTF-8"?>
<testsuites name="bun test" tests="13" failures="0" skipped="1">
  <testsuite name="b.test.ts" file="b.test.ts" tests="2">
    <testcase name="b fast" classname="" time="0.002" file="b.test.ts" line="1" assertions="1" />
    <testcase name="b medium" classname="" time="0.4" file="b.test.ts" line="2" assertions="1" />
  </testsuite>
  <testsuite name="a.test.ts" file="a.test.ts" tests="11">
    <testcase name="a one" classname="" time="0.1" file="a.test.ts" line="1" assertions="1" />
    <testcase name="a two" classname="" time="0.9" file="a.test.ts" line="2" assertions="1" />
    <testcase name="a three" classname="" time="2.5" file="a.test.ts" line="3" assertions="1" />
    <testcase name="a four" classname="" time="0.3" file="a.test.ts" line="4" assertions="1" />
    <testcase name="a five" classname="" time="0.05" file="a.test.ts" line="5" assertions="1" />
    <testcase name="a six" classname="" time="0.6" file="a.test.ts" line="6" assertions="1" />
    <testcase name="a seven" classname="" time="0.7" file="a.test.ts" line="7" assertions="1" />
    <testcase name="a eight" classname="" time="0.8" file="a.test.ts" line="8" assertions="1" />
    <testcase name="a nine" classname="" time="0.01" file="a.test.ts" line="9" assertions="1" />
    <testcase name="a ten" classname="" time="1.5" file="a.test.ts" line="10" assertions="1" />
    <testcase name="a eleven" classname="" time="0.2" file="a.test.ts" line="11" assertions="1" />
    <testcase name="a skipped" classname="" time="0" file="a.test.ts" line="12" assertions="0"><skipped /></testcase>
  </testsuite>
  <testsuite name="c.test.ts" file="c.test.ts" tests="1">
    <testcase name="deep" classname="inner &gt; outer" time="0.35" file="c.test.ts" line="1" assertions="1" />
  </testsuite>
</testsuites>`;

test('the report lists the slowest files and tests first, at most 10 of each', () => {
  expect(timingReport(parseTimings(sampleJUnit))).toBe(
    [
      'Slowest test files (3):',
      '  1. a.test.ts  7.66s',
      '  2. b.test.ts  0.40s',
      '  3. c.test.ts  0.35s',
      '',
      'Slowest tests (10):',
      '  1. a.test.ts > a three  2.50s',
      '  2. a.test.ts > a ten  1.50s',
      '  3. a.test.ts > a two  0.90s',
      '  4. a.test.ts > a eight  0.80s',
      '  5. a.test.ts > a seven  0.70s',
      '  6. a.test.ts > a six  0.60s',
      '  7. b.test.ts > b medium  0.40s',
      '  8. c.test.ts > inner > outer > deep  0.35s',
      '  9. a.test.ts > a four  0.30s',
      '  10. a.test.ts > a eleven  0.20s',
    ].join('\n'),
  );
});

test('a run that wrote no times says so', () => {
  expect(timingReport(null)).toBe('No per-test times: the budget reads them from a bun test run.');
});

const slowTests = [
  "import { expect, test } from 'bun:test';",
  "test('slow', async () => { await Bun.sleep(120); expect(1).toBe(1); });",
  '',
].join('\n');
const fastTests = [
  "import { expect, test } from 'bun:test';",
  "test('fast', () => { expect(1).toBe(1); });",
  '',
].join('\n');
const script = path.join(import.meta.dir, 'test-budget.ts');

test('the script lists the slowest files and tests with --report, slowest first', async () => {
  const { stdout, exitCode } = await inRepo(
    { 'slow.test.ts': slowTests, 'fast.test.ts': fastTests },
    (root) => {
      const run = Bun.spawnSync([process.execPath, script, '--report', '60', '--', 'bun', 'test'], {
        cwd: root,
        stdout: 'pipe',
        stderr: 'pipe',
      });
      return { stdout: run.stdout.toString(), exitCode: run.exitCode };
    },
  );
  expect(exitCode).toBe(0);
  expect(stdout.indexOf('  1. slow.test.ts')).toBeGreaterThan(-1);
  expect(stdout.indexOf('  1. slow.test.ts')).toBeLessThan(stdout.indexOf('  2. fast.test.ts'));
  expect(stdout).toContain('  1. slow.test.ts > slow  ');
});

test('over budget, the script fails with the fix hint and the same listing', async () => {
  const { stderr, exitCode } = await inRepo({ 'slow.test.ts': slowTests }, (root) => {
    const run = Bun.spawnSync([process.execPath, script, '0.01', '--', 'bun', 'test'], {
      cwd: root,
      stdout: 'pipe',
      stderr: 'pipe',
    });
    return { stderr: run.stderr.toString(), exitCode: run.exitCode };
  });
  expect(exitCode).toBe(1);
  expect(stderr).toContain('The budget is 0.01s.');
  expect(stderr).toContain('Never delete or skip a test');
  expect(stderr).toContain('Slowest tests (1):');
  expect(stderr).toContain('  1. slow.test.ts > slow  ');
});
