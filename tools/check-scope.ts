import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';

import { findBase } from '@tools/check-base';
import { parse } from 'yaml';

/**
 * The scope limit of one pull request, for a PR only:
 *
 * - It changes at most `pr_size.max` lines of `clutch.yaml`. A larger change is
 *   more than one piece of scoped work, so it splits.
 * - A PR that adds a screen changes an issue that says `hand_test: yes` or
 *   `hand_test: no`, so the choice is written down before the merge. See
 *   docs/principles/proof-gates-code.md#the-owner-decides.
 */
const screen = /^features\/[^/]+\/screens\/(?!\.gitkeep$).+$/u;
const issue = /^\.clutch\/issues\/[^/]+\.md$/u;
/** A generated tracker, a lockfile and a screenshot baseline are not written work. */
const alwaysExcluded = ['.clutch/TRACKER.md', '**/*.lock', '**/__screenshots__/**'];

export const defaultMax = 1000;

function git(root: string, ...args: Array<string>) {
  const run = Bun.spawnSync(['git', '-C', root, ...args]);
  if (run.exitCode !== 0) {
    throw new Error(`git ${args.join(' ')} failed: ${run.stderr.toString()}`);
  }
  return run.stdout.toString().trim();
}

function changedLines(root: string, range: Array<string>, exclude: ReadonlyArray<string>) {
  const skip = [...alwaysExcluded, ...exclude].map((pattern) => new Bun.Glob(pattern));
  let total = 0;
  for (const line of git(root, 'diff', '--numstat', ...range)
    .split('\n')
    .filter(Boolean)) {
    const [added = '0', removed = '0', file = ''] = line.split('\t');
    if (added !== '-' && !skip.some((glob) => glob.match(file))) {
      total += Number(added) + Number(removed);
    }
  }
  return total;
}

/** A file's text at `head`, or in the working tree. Empty when the PR deletes it. */
function contentOf(root: string, head: string | null, file: string) {
  if (head) {
    return Bun.spawnSync(['git', '-C', root, 'show', `${head}:${file}`]).stdout.toString();
  }
  return existsSync(path.join(root, file)) ? readFileSync(path.join(root, file), 'utf-8') : '';
}

function statesHandTest(root: string, head: string | null, files: ReadonlyArray<string>) {
  return files
    .filter((file) => issue.test(file))
    .some((file) => /^hand_test:\s*(?:yes|no)\s*$/mu.test(contentOf(root, head, file)));
}

export function checkScope(
  root: string,
  base: string,
  limits: { max: number; exclude: ReadonlyArray<string> },
  head: string | null = null,
) {
  const range = head ? [`${base}...${head}`] : [base];
  const errors: Array<string> = [];
  const lines = changedLines(root, range, limits.exclude);
  if (lines > limits.max) {
    errors.push(`The PR changes ${lines} lines, over the limit of ${limits.max}. Split it.`);
  }
  const listed = git(root, 'diff', '--name-status', ...range)
    .split('\n')
    .filter(Boolean);
  const files = listed.map((line) => line.split('\t').at(-1) ?? '');
  const added = listed
    .filter((line) => line.startsWith('A'))
    .map((line) => line.split('\t')[1] ?? '')
    .filter((file) => screen.test(file));
  if (added.length > 0 && !statesHandTest(root, head, files)) {
    errors.push(
      `The PR adds ${added.join(', ')}, and no changed issue says \`hand_test: yes\` or \`hand_test: no\`.`,
    );
  }
  return errors;
}

if (import.meta.main) {
  if (process.env.GITHUB_EVENT_NAME === 'pull_request') {
    const root = process.cwd();
    // GitHub reports a stacked PR's base as the default branch, so CI passes the
    // PR's own base commit and head. Otherwise the check counts the whole stack.
    const base = process.env.SCOPE_BASE ?? findBase(root, process.env.CHECK_BASE);
    const head = process.env.SCOPE_HEAD ?? null;
    const config = parse(readFileSync(path.join(root, 'clutch.yaml'), 'utf-8')) as {
      pr_size?: { max?: number; exclude?: Array<string> };
    } | null;
    if (!base) {
      throw new Error('No base commit, so the scope limit cannot run.');
    }
    const errors = checkScope(
      root,
      base,
      { max: config?.pr_size?.max ?? defaultMax, exclude: config?.pr_size?.exclude ?? [] },
      head,
    );
    if (errors.length > 0) {
      console.error(errors.join('\n'));
      process.exitCode = 1;
    } else {
      console.log('The PR is inside its scope limit.');
    }
  } else {
    console.log('The scope limit applies to a pull request only.');
  }
}
