import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';

import { quarantined, registryFile } from '@tools/flaky';
import type { FlakyTest } from '@tools/flaky';

/**
 * Each quarantined test in `tools/flaky-tests.json` needs an open issue that
 * owns its fix, a reason, and an expiry. A quarantine that outlives its expiry,
 * or whose issue is done, fails, so a flaky test cannot stay hidden. See
 * docs/contributing/testing.md#flaky-tests.
 */

/** The longest quarantine, in days. An entry must end no later than this many days from today. */
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

/** True when the test file declares a test with exactly this name, in any quote style. */
function declares(source: string, name: string): boolean {
  return ["'", '"', '`'].some((quote) => source.includes(`${quote}${name}${quote}`));
}

function addDays(date: string, days: number): string {
  const next = new Date(`${date}T00:00:00Z`);
  next.setUTCDate(next.getUTCDate() + days);
  return next.toISOString().slice(0, 10);
}

function entryProblems(root: string, entry: FlakyTest, today: string): Array<string> {
  const where = `${registryFile}: ${entry.file ?? '?'} "${entry.name ?? '?'}"`;
  const missing = (['file', 'name', 'issue', 'until', 'reason'] as const).filter(
    (field) => typeof entry[field] !== 'string' || entry[field].trim() === '',
  );
  if (missing.length) {
    return [
      `${where}: add ${missing.join(', ')}. Each entry needs file, name, issue, until and reason.`,
    ];
  }
  const problems: Array<string> = [];
  if (!bunTest.test(entry.file)) {
    problems.push(
      `${where}: only bun test files can be quarantined. Fix the test, or file an issue.`,
    );
  } else if (!existsSync(path.join(root, entry.file))) {
    problems.push(`${where}: the file does not exist. Fix the path, or remove the entry.`);
  } else if (!declares(readFileSync(path.join(root, entry.file), 'utf-8'), entry.name)) {
    problems.push(
      `${where}: the file has no test with this exact name. Copy the name from the test, or remove the entry.`,
    );
  }
  if (!datePattern.test(entry.until)) {
    problems.push(`${where}: until must be a date such as 2026-11-30.`);
  } else if (entry.until < today) {
    problems.push(
      `${where}: the quarantine ended on ${entry.until}. Fix the test under ${entry.issue} and remove the entry. A new date needs a new reason, at most ${maxDays} days ahead.`,
    );
  } else if (entry.until > addDays(today, maxDays)) {
    problems.push(
      `${where}: until ${entry.until} is more than ${maxDays} days ahead. Pick a date no later than ${addDays(today, maxDays)}.`,
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

/** Every problem with the quarantine registry at `root` on `today`, a YYYY-MM-DD date. */
export function checkFlakyTests(root: string, today: string): Array<string> {
  const entries = quarantined(root);
  const problems = entries.flatMap((entry) => entryProblems(root, entry, today));
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
  const problems = checkFlakyTests(process.cwd(), new Date().toISOString().slice(0, 10));
  if (problems.length) {
    console.error(
      [
        `Flaky-test quarantine check failed (${problems.length}).`,
        'Each quarantined test needs an open issue, a reason and an expiry. See docs/contributing/testing.md#flaky-tests.',
        '',
        ...problems,
      ].join('\n'),
    );
    process.exitCode = 1;
  } else {
    const count = quarantined(process.cwd()).length;
    console.log(`${count} quarantined test(s), each with an open issue and an expiry.`);
  }
}
