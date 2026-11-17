import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';

import { findBase } from '@tools/check-base';
import { escape, journeyFile, parseRegistry, registry, registryFile } from '@tools/flaky';
import type { FlakyTest, RemovedTest } from '@tools/flaky';

/**
 * Each quarantined test in `tools/flaky-tests.json` needs an open issue that
 * owns its fix, a reason, a first day and an expiry. A quarantine that outlives
 * its expiry, or whose issue is done, fails, so a flaky test cannot stay
 * hidden. A quarantine cannot be renewed: its first day never moves. A flaky
 * test whose cause was not found is deleted, and its `removed` entry keeps the
 * reason. See docs/contributing/testing.md#flaky-tests.
 */

/** The longest quarantine, in days from its first day. */
export const maxDays = 30;

const datePattern = /^\d{4}-\d{2}-\d{2}$/u;
const issuePattern = /^CL-\d{3}[a-z]?$/u;
const bunTest = /\.test\.[cm]?[jt]sx?$/u;

/** The `status:` of an issue file, or null when the file or the field is missing. */
function issueStatus(root: string, issue: string): string | null {
  const file = path.join(root, '.clutch/issues', `${issue}.md`);
  if (!existsSync(file)) {
    return null;
  }
  const frontmatter = /^---\n([\s\S]*?)\n---/u.exec(readFileSync(file, 'utf-8'))?.[1] ?? '';
  return /^status:\s*(\S+)/mu.exec(frontmatter)?.[1] ?? null;
}

/**
 * True when `source` declares a test with exactly this name, in any quote
 * style. In a bun test file, the name is the first argument of a test call:
 * `test`, `it` and their forms, such as `test.only(...)` or
 * `test.each(table)(...)`. In a journey, it is the name in a `snap` call. A
 * name in any other string, such as an `expect` message, does not count. It
 * reads one line at a time, so it does not see a call split over lines before
 * the name, or a name built from a variable or a template with `${}`.
 */
export function declares(source: string, name: string, file: string): boolean {
  const quoted = `(['"\`])${escape(name)}\\1`;
  const call = journeyFile.test(file)
    ? String.raw`\bsnap\([^,\n]*,\s*`
    : String.raw`(?:^|[^\w.$])(?:test|it)(?:\.\w+)*(?:\([^\n]*?\))?\s*\(\s*`;
  return new RegExp(call + quoted, 'mu').test(source);
}

/** True when `value` is a YYYY-MM-DD string that names a real calendar day. */
function isDate(value: string): boolean {
  if (!datePattern.test(value)) {
    return false;
  }
  const date = new Date(`${value}T00:00:00Z`);
  return !Number.isNaN(date.getTime()) && date.toISOString().slice(0, 10) === value;
}

function addDays(date: string, days: number): string {
  const next = new Date(`${date}T00:00:00Z`);
  next.setUTCDate(next.getUTCDate() + days);
  return next.toISOString().slice(0, 10);
}

/** The fields of `entry` that are missing or blank. */
function missingFields<T extends object>(entry: T, fields: ReadonlyArray<keyof T>) {
  return fields.filter((field) => {
    const value = entry[field];
    return typeof value !== 'string' || value.trim() === '';
  });
}

function entryProblems(
  root: string,
  entry: FlakyTest,
  today: string,
  base: ReadonlyArray<Partial<FlakyTest>>,
  removed: ReadonlyArray<RemovedTest>,
): Array<string> {
  const where = `${registryFile}: ${entry.file ?? '?'} "${entry.name ?? '?'}"`;
  const missing = missingFields(entry, ['file', 'name', 'issue', 'since', 'until', 'reason']);
  if (missing.length) {
    return [
      `${where}: add ${missing.join(', ')}. Each entry needs file, name, issue, since, until and reason.`,
    ];
  }
  const problems: Array<string> = [];
  if (!bunTest.test(entry.file) && !journeyFile.test(entry.file)) {
    problems.push(
      `${where}: only bun test files and journey screenshots can be quarantined. Fix the test, or file an issue.`,
    );
  } else if (!existsSync(path.join(root, entry.file))) {
    problems.push(`${where}: the file does not exist. Fix the path, or remove the entry.`);
  } else if (
    !declares(readFileSync(path.join(root, entry.file), 'utf-8'), entry.name, entry.file)
  ) {
    problems.push(
      `${where}: the file has no test with this exact name. Copy the name from the test, or remove the entry.`,
    );
  }
  // A base entry with the same issue, or the same file and name, keeps its first day.
  const before = base.filter(
    (old) =>
      typeof old.since === 'string' &&
      (old.issue === entry.issue || (old.file === entry.file && old.name === entry.name)),
  );
  if (!isDate(entry.since)) {
    problems.push(`${where}: since must be a real date such as 2026-11-01.`);
  } else if (entry.since > today) {
    problems.push(
      `${where}: since ${entry.since} is in the future. Use the first day of the quarantine.`,
    );
  } else if (before.length && !before.some((old) => old.since === entry.since)) {
    problems.push(
      `${where}: since moved from ${before[0].since} to ${entry.since}. A quarantine cannot be renewed. Put back ${before[0].since}.`,
    );
  }
  if (!isDate(entry.until)) {
    problems.push(`${where}: until must be a real date such as 2026-11-30.`);
  } else if (entry.until < today) {
    problems.push(
      `${where}: the quarantine ended on ${entry.until}, and it cannot be renewed. Fix the test under ${entry.issue} and remove the entry. Or delete the test, and move the entry to "removed" with what you tried and why the cause was not found.`,
    );
  } else if (isDate(entry.since) && entry.until > addDays(entry.since, maxDays)) {
    problems.push(
      `${where}: until ${entry.until} is more than ${maxDays} days after since ${entry.since}. Pick a date no later than ${addDays(entry.since, maxDays)}.`,
    );
  }
  if (
    removed.some(
      (gone) =>
        gone.issue === entry.issue || (gone.file === entry.file && gone.name === entry.name),
    )
  ) {
    problems.push(
      `${where}: this test or its issue is in "removed". A removed test does not come back as a quarantine. Fix it under a new issue.`,
    );
  }
  if (issuePattern.test(entry.issue)) {
    const status = issueStatus(root, entry.issue);
    if (status === null) {
      problems.push(
        `${where}: ${entry.issue} does not exist. File it with clutch issues new, so someone owns the fix.`,
      );
    } else if (status === 'done') {
      problems.push(
        `${where}: ${entry.issue} is done, but the test is still quarantined. Remove the entry, or file a new issue for the flake.`,
      );
    }
  } else {
    problems.push(`${where}: issue must be an id such as CL-128.`);
  }
  return problems;
}

function removedProblems(root: string, entry: RemovedTest, today: string): Array<string> {
  const where = `${registryFile}: removed ${entry.file ?? '?'} "${entry.name ?? '?'}"`;
  const missing = missingFields(entry, ['file', 'name', 'removed', 'reason', 'issue']);
  if (missing.length) {
    return [
      `${where}: add ${missing.join(', ')}. Each removed test needs file, name, removed, reason and issue. The reason says what was tried and why the cause was not found.`,
    ];
  }
  const problems: Array<string> = [];
  if (!isDate(entry.removed)) {
    problems.push(`${where}: removed must be a real date such as 2026-11-30.`);
  } else if (entry.removed > today) {
    problems.push(
      `${where}: removed ${entry.removed} is in the future. Use the day of the removal.`,
    );
  }
  if (!issuePattern.test(entry.issue)) {
    problems.push(`${where}: issue must be an id such as CL-128.`);
  } else if (issueStatus(root, entry.issue) === null) {
    problems.push(`${where}: ${entry.issue} does not exist. Name the issue that owned the fix.`);
  }
  const file = path.join(root, entry.file);
  if (existsSync(file) && declares(readFileSync(file, 'utf-8'), entry.name, entry.file)) {
    problems.push(
      `${where}: the test is still in the file. Delete it, or move the entry back to "tests".`,
    );
  }
  return problems;
}

/** The quarantine entries at the base commit. With no base, or no registry there, there are none. */
export function baseTests(root: string, base: string | null): Array<FlakyTest> {
  if (!base) {
    return [];
  }
  const run = Bun.spawnSync(['git', '-C', root, 'show', `${base}:${registryFile}`]);
  return run.exitCode === 0 ? parseRegistry(run.stdout.toString()).tests : [];
}

/**
 * Every problem with the quarantine registry at `root` on `today`, a
 * YYYY-MM-DD date. `base` holds the entries on the base branch: an entry there
 * keeps its `since`. An older registry may have entries with no `since`.
 */
export function checkFlakyTests(
  root: string,
  today: string,
  base: ReadonlyArray<Partial<FlakyTest>> = [],
): Array<string> {
  const { tests: entries, removed } = registry(root);
  const problems = [
    ...entries.flatMap((entry) => entryProblems(root, entry, today, base, removed)),
    ...removed.flatMap((entry) => removedProblems(root, entry, today)),
  ];
  const seen = new Set<string>();
  for (const entry of entries) {
    const key = `${entry.file}\n${entry.name}`;
    if (seen.has(key)) {
      problems.push(`${registryFile}: ${entry.file} "${entry.name}" is listed twice. Keep one.`);
    }
    seen.add(key);
  }
  return problems;
}

if (import.meta.main) {
  const root = process.cwd();
  const base = baseTests(root, findBase(root, process.env.CHECK_BASE));
  const problems = checkFlakyTests(root, new Date().toISOString().slice(0, 10), base);
  if (problems.length) {
    console.error(
      [
        `Flaky-test quarantine check failed (${problems.length}).`,
        'Each quarantined test needs an open issue, a reason, a first day and an expiry. See docs/contributing/testing.md#flaky-tests.',
        '',
        ...problems,
      ].join('\n'),
    );
    process.exitCode = 1;
  } else {
    const { tests, removed } = registry(root);
    console.log(
      `${tests.length} quarantined test(s), each with an open issue and an expiry. ${removed.length} removed test(s), each with a reason.`,
    );
  }
}
