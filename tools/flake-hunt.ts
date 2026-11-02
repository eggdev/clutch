import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';

import { quarantined, registryFile } from '@tools/flaky';
import type { FlakyTest } from '@tools/flaky';

/**
 * The nightly flake hunt. `.github/workflows/flake-hunt.yml` runs the tests
 * many times with `bun test --rerun-each` and a JUnit report. This script reads
 * the report, finds each test that passed on some runs and failed on others,
 * and quarantines each new one in `tools/flaky-tests.json` with a new issue.
 * See docs/contributing/testing.md#flaky-tests.
 */

/** How long a test that the hunt finds stays quarantined. The issue's owner fixes it in that time. */
export const quarantineDays = 14;

export type Tally = {
  readonly file: string;
  readonly name: string;
  passed: number;
  failed: number;
};

const decode = (text: string) =>
  text
    .replaceAll('&quot;', '"')
    .replaceAll('&apos;', "'")
    .replaceAll('&lt;', '<')
    .replaceAll('&gt;', '>')
    .replaceAll('&amp;', '&');

const attribute = (tag: string, name: string) =>
  decode(new RegExp(`\\s${name}="([^"]*)"`, 'u').exec(tag)?.[1] ?? '');

/** The passes and failures of each test in a bun JUnit report, by file and name. A skipped run counts as neither. */
export function tally(junit: string): Array<Tally> {
  const tests = new Map<string, Tally>();
  const testcase = /<testcase\b([^>]*?)(\/>|>([\s\S]*?)<\/testcase>)/gu;
  for (const match of junit.matchAll(testcase)) {
    const tag = match[1];
    const body = match[3] ?? '';
    if (body.includes('<skipped')) {
      continue;
    }
    const file = attribute(tag, 'file');
    const name = attribute(tag, 'name');
    const key = `${file}\n${name}`;
    const entry = tests.get(key) ?? { file, name, passed: 0, failed: 0 };
    if (body.includes('<failure') || body.includes('<error')) {
      entry.failed += 1;
    } else {
      entry.passed += 1;
    }
    tests.set(key, entry);
  }
  return [...tests.values()];
}

/** The tests that passed and failed on the same code, which no quarantine entry names yet. */
export function newFlakes(tallies: ReadonlyArray<Tally>, known: ReadonlyArray<FlakyTest>) {
  return tallies.filter(
    (test) =>
      test.passed > 0 &&
      test.failed > 0 &&
      !known.some((entry) => entry.file === test.file && entry.name === test.name),
  );
}

export function addDays(date: string, days: number): string {
  const next = new Date(`${date}T00:00:00Z`);
  next.setUTCDate(next.getUTCDate() + days);
  return next.toISOString().slice(0, 10);
}

/** The quarantine entry for one flake, with the issue that owns its fix. */
export function entryFor(flake: Tally, issue: string, today: string, runUrl: string): FlakyTest {
  const runs = flake.passed + flake.failed;
  return {
    file: flake.file,
    name: flake.name,
    issue,
    until: addDays(today, quarantineDays),
    reason: `The flake hunt on ${today} saw it fail ${flake.failed} of ${runs} runs on the same code (${runUrl}).`,
  };
}

/** The body of the issue that owns one flake. */
export function issueBody(flake: Tally, runUrl: string): string {
  return [
    '## Goal',
    '',
    `\`${flake.file}\` "${flake.name}" passes every time, and leaves the quarantine in \`${registryFile}\`.`,
    '',
    '## Context',
    '',
    `The nightly flake hunt ran it ${flake.passed + flake.failed} times on the same code. It failed ${flake.failed} times: ${runUrl}`,
    '',
    '## Steps',
    '',
    '1. Find what the test depends on that changes between runs: time, order, a shared file, a port or a random value.',
    '2. Make the test wait for the event it needs, or own the state it uses. Never skip it.',
    `3. Remove its entry from \`${registryFile}\`.`,
    '',
    '## Acceptance criteria',
    '',
    `- \`bun test ${flake.file} --rerun-each 20\` passes.`,
    '- `check-flaky-tests` passes with the entry removed.',
    '',
    '## Verify',
    '',
    '```bash',
    `mise exec -- bun test ${flake.file} --rerun-each 20`,
    '```',
    '',
  ].join('\n');
}

/** Files one issue through the project's own `clutch issues new`, and returns its id. */
function fileIssue(root: string, flake: Tally, phase: string, runUrl: string): string {
  const run = Bun.spawnSync(
    [
      'bun',
      'run',
      'clutch',
      'issues',
      'new',
      '--phase',
      phase,
      '--title',
      `Fix the flaky test "${flake.name}"`,
    ],
    { cwd: root, stdout: 'pipe', stderr: 'inherit' },
  );
  const out = run.stdout.toString();
  const match = /(CL-\d{3}[a-z]?)\s+(\S+\.md)/u.exec(out);
  if (run.exitCode !== 0 || !match) {
    throw new Error(`clutch issues new failed: ${out}`);
  }
  const file = path.join(root, match[2].replace(/\.$/u, ''));
  const text = readFileSync(file, 'utf-8');
  writeFileSync(file, `${text.slice(0, text.indexOf('## Goal'))}${issueBody(flake, runUrl)}`);
  return match[1];
}

if (import.meta.main) {
  const [junitFile, runUrl = 'a local run', phase = 'later'] = process.argv.slice(2);
  if (!junitFile) {
    throw new Error('Usage: bun tools/flake-hunt.ts <junit.xml> [run URL] [issue phase]');
  }
  const root = process.cwd();
  const today = new Date().toISOString().slice(0, 10);
  const known = quarantined(root);
  const flakes = newFlakes(tally(readFileSync(junitFile, 'utf-8')), known);
  for (const flake of flakes) {
    console.log(
      `Flaky: ${flake.file} "${flake.name}" failed ${flake.failed} of ${flake.passed + flake.failed} runs.`,
    );
  }
  if (flakes.length > 0) {
    const added = flakes.map((flake) =>
      entryFor(flake, fileIssue(root, flake, phase, runUrl), today, runUrl),
    );
    const file = path.join(root, registryFile);
    const registry = (
      existsSync(file) ? JSON.parse(readFileSync(file, 'utf-8')) : { tests: [] }
    ) as { tests: Array<FlakyTest> };
    registry.tests.push(...added);
    writeFileSync(file, `${JSON.stringify(registry, null, 2)}\n`);
  }
  console.log(`${flakes.length} new flaky test(s).`);
  if (process.env.GITHUB_OUTPUT) {
    writeFileSync(process.env.GITHUB_OUTPUT, `found=${flakes.length}\n`, { flag: 'a' });
  }
}
