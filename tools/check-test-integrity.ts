import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';

import { findBase } from '@tools/check-migrations';

/**
 * A change may not weaken the tests quietly. This check compares the working
 * tree with the same base commit as check-migrations. It fails when a change
 * deletes a test file, renames it to a name that does not run, or lowers the
 * number of tests or assertions in a test file. A deleted test passes when the
 * same change deletes the module it tests, or when tools/test-integrity-allow.json
 * lists the test file with a reason. See docs/contributing/testing.md#test-integrity.
 */
export const allowList = 'tools/test-integrity-allow.json';
const testFile = /(?:\.(?:test|spec)\.[cm]?[jt]sx?|\.pw\.[jt]s)$/u;
const testCall = /(?<![.\w])(?:test|it)(?:\.each\([^)]*\))?\s*\(/gu;
const assertionCall = /(?<![.\w])(?:expect|assert)(?:[A-Z]\w*)?\s*\(/gu;

type Counts = { tests: number; assertions: number };

function git(root: string, ...args: Array<string>): string | null {
  const run = Bun.spawnSync(['git', '-C', root, ...args]);
  return run.exitCode === 0 ? run.stdout.toString() : null;
}

export function countsOf(source: string): Counts {
  return {
    tests: [...source.matchAll(testCall)].length,
    assertions: [...source.matchAll(assertionCall)].length,
  };
}

/** The module that a test file tests: `pool.test.ts` tests `pool.ts` or `pool.tsx`. */
export function modulesOf(file: string): Array<string> {
  const stem = file.replace(/\.(?:test|spec)\.[cm]?[jt]sx?$/u, '');
  return stem === file ? [] : ['.ts', '.tsx', '.mjs', '.js'].map((extension) => stem + extension);
}

function readAllowList(root: string): { files: Record<string, string>; problems: Array<string> } {
  const file = path.join(root, allowList);
  const files: Record<string, string> = existsSync(file)
    ? (JSON.parse(readFileSync(file, 'utf-8')).files ?? {})
    : {};
  const problems = Object.entries(files)
    .filter(([, reason]) => !reason.trim())
    .map(([name]) => `${allowList}: \`${name}\` has no reason. Say why the test can go.`);
  return { files, problems };
}

export function checkTestIntegrity(root: string, base: string | null): Array<string> {
  if (!base) {
    return [];
  }
  const listed = git(root, 'diff', '--name-status', '-M', base);
  if (listed === null) {
    throw new Error(`git diff against ${base} failed.`);
  }
  const { files: allowed, problems } = readAllowList(root);
  const changes = listed
    .split('\n')
    .filter(Boolean)
    .map((line) => line.split('\t'));
  const deleted = new Set(
    changes
      .filter(([status]) => status.startsWith('D') || status.startsWith('R'))
      .map(([, before]) => before),
  );
  for (const [status, before, after] of changes) {
    if (!testFile.test(before) || status.startsWith('A') || Object.hasOwn(allowed, before)) {
      continue;
    }
    const now = status.startsWith('R') ? after : before;
    if (status.startsWith('D') || !testFile.test(now)) {
      if (modulesOf(before).some((module) => deleted.has(module))) {
        continue;
      }
      problems.push(
        `${before}: the change ${status.startsWith('D') ? 'deletes it' : `renames it to ${now}, which no test runner runs`}. Keep the test, or delete the module it tests in the same change. A different reason goes in ${allowList} for a person to review.`,
      );
      continue;
    }
    const was = countsOf(git(root, 'show', `${base}:${before}`) ?? '');
    const is = countsOf(readFileSync(path.join(root, now), 'utf-8'));
    if (is.tests < was.tests || is.assertions < was.assertions) {
      problems.push(
        `${now}: tests ${was.tests} -> ${is.tests}, assertions ${was.assertions} -> ${is.assertions}. A change may not lower either. Restore what the tests prove, or list the file in ${allowList} with a reason for a person to review.`,
      );
    }
  }
  return problems;
}

if (import.meta.main) {
  const root = process.cwd();
  const base = findBase(root, process.env.CHECK_BASE);
  const problems = checkTestIntegrity(root, base);
  if (problems.length) {
    console.error(
      [
        `Test integrity check failed (${problems.length}).`,
        'A change may not delete tests or assertions quietly.',
        'See docs/contributing/testing.md#test-integrity.',
        '',
        ...problems,
      ].join('\n'),
    );
    process.exitCode = 1;
  } else {
    console.log(
      base
        ? 'No change deletes a test or lowers its tests or assertions.'
        : 'No origin/main yet. No test has merged.',
    );
  }
}
