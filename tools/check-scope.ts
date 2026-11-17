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
 * - After kickoff, a PR that adds a feature changes an issue whose `goal:` names
 *   a user goal from docs/contributing/project-intent.md, so the product cannot
 *   drift from who it is for.
 * - A PR adds a target to a blocking list only when the base has that target
 *   in the observed list, or in a blocking list already. A true rename passes:
 *   the new target runs the command of a removed one. See
 *   docs/contributing/setup/checks.md#observed-checks.
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

/** The YAML frontmatter of an issue file. Empty when it has none. */
const frontmatter = (text: string) => /^---\n([\s\S]*?)\n---(?:\n|$)/u.exec(text)?.[1] ?? '';

/** Whether a changed issue states `hand_test:` in its frontmatter. A body line does not count. */
function statesHandTest(root: string, head: string | null, files: ReadonlyArray<string>) {
  return files
    .filter((file) => issue.test(file))
    .some((file) =>
      /^hand_test:\s*(?:yes|no)\s*$/mu.test(frontmatter(contentOf(root, head, file))),
    );
}

const intentFile = 'docs/contributing/project-intent.md';

/** The new `features/<name>` folders of the diff. */
function newFeatures(root: string, base: string, added: ReadonlyArray<string>) {
  const names = new Set(added.flatMap((file) => /^features\/([^/]+)\//u.exec(file)?.[1] ?? []));
  return [...names].filter((name) => !git(root, 'ls-tree', base, `features/${name}/`));
}

/** The entries of project intent: each table cell and each bullet, in lower case. */
function intentEntries(root: string) {
  const file = path.join(root, intentFile);
  const lines = existsSync(file) ? readFileSync(file, 'utf-8').split('\n') : [];
  return new Set(
    lines
      .filter((line) => /^\s*[|*-]/u.test(line))
      .flatMap((line) => line.split('|'))
      .map((part) =>
        part
          .replace(/^\s*[-*]\s*/u, '')
          .trim()
          .toLowerCase(),
      ),
  );
}

/** Whether a changed issue's `goal:` is an entry of project intent, whole. A substring is not. */
function namesGoal(root: string, files: ReadonlyArray<string>) {
  const entries = intentEntries(root);
  return files
    .filter((file) => issue.test(file) && existsSync(path.join(root, file)))
    .some((file) => {
      const goal = /^goal:\s*['"]?(.+?)['"]?\s*$/mu.exec(
        readFileSync(path.join(root, file), 'utf-8'),
      )?.[1];
      return goal !== undefined && entries.has(goal.trim().toLowerCase());
    });
}

/** The text of `file` at `rev`. Empty when the file is not there. */
const textAt = (root: string, rev: string, file: string) =>
  Bun.spawnSync(['git', '-C', root, 'show', `${rev}:${file}`]).stdout.toString();

/** `source` without its comments. A string keeps its text, so `//` in a URL stays. */
const withoutComments = (source: string) =>
  source.replaceAll(
    /('(?:[^'\\\n]|\\.)*'|"(?:[^"\\\n]|\\.)*"|`(?:[^`\\]|\\.)*`)|\/\/[^\n]*|\/\*[\s\S]*?\*\//gu,
    (match, text: string | undefined) => text ?? '',
  );

/**
 * The string items of the array `name` in the source of tools/validate.ts, or
 * null. It matches the exact name, then `:` or `=`, then an array literal.
 */
export function sourceList(source: string, name: string) {
  const body = new RegExp(`export const ${name}\\s*(?::[^=]*)?=\\s*\\[([^\\]]*)\\]`, 'u').exec(
    withoutComments(source),
  )?.[1];
  return body === undefined ? null : [...body.matchAll(/'([^']+)'/gu)].map((match) => match[1]);
}

/** The root Nx targets of package.json, or null. */
function rootTargets(json: string): Record<string, unknown> | null {
  try {
    const targets = JSON.parse(json)?.nx?.targets;
    return typeof targets === 'object' && targets !== null ? targets : null;
  } catch {
    return null;
  }
}

/** The `dependsOn` list of the root `checks` target, or null. */
function checksList(targets: Record<string, unknown> | null) {
  const list = (targets?.checks as { dependsOn?: unknown } | undefined)?.dependsOn;
  return Array.isArray(list) ? list.filter((item) => typeof item === 'string') : null;
}

/** The command of a root target, as text, or null when it has none. */
function commandOf(targets: Record<string, unknown> | null, target: string) {
  const options = (targets?.[target] as { options?: { command?: unknown; commands?: unknown } })
    ?.options;
  const command = options?.command ?? options?.commands;
  return command === undefined ? null : JSON.stringify(command);
}

/** The blocking lists and the observed list of a revision. A list it lacks is null. */
function targetLists(read: (file: string) => string) {
  const validate = read('tools/validate.ts');
  const targets = rootTargets(read('package.json'));
  return {
    targets,
    blocking: [
      { name: 'the dependsOn list of checks in package.json', list: checksList(targets) },
      {
        name: 'validateTargets in tools/validate.ts',
        list: sourceList(validate, 'validateTargets'),
      },
    ],
    observed: new Set(sourceList(validate, 'observedTargets')),
  };
}

/**
 * The problems with the blocking lists of the PR. A target that the PR adds to
 * a blocking list, while the base has it in no list, is one. A true rename
 * passes: the PR removes a blocking target, and the new target at the head
 * runs the same command as the old one at the base. A list that the base
 * lacks, such as in a project without tools/validate.ts, is skipped. A list
 * that the base has and the head cannot be read is a problem.
 */
export function blockingProblems(root: string, base: string, head: string | null) {
  const before = targetLists((file) => textAt(root, base, file));
  const after = targetLists((file) => contentOf(root, head, file));
  const problems: Array<string> = [];
  const was = new Set<string>();
  const now = new Set<string>();
  for (const [at, { name, list }] of before.blocking.entries()) {
    const next = after.blocking[at]?.list ?? null;
    if (list === null) {
      continue;
    }
    if (next === null) {
      problems.push(
        `check-scope cannot read ${name} at the head, so it cannot check new blocking targets. Write it as an array of strings.`,
      );
      continue;
    }
    for (const target of list) {
      was.add(target);
    }
    for (const target of next) {
      now.add(target);
    }
  }
  const removed = new Set(
    [...was]
      .filter((target) => !now.has(target))
      .map((target) => commandOf(before.targets, target))
      .filter((command) => command !== null),
  );
  for (const target of now) {
    if (was.has(target) || before.observed.has(target)) {
      continue;
    }
    const command = commandOf(after.targets, target);
    if (command !== null && removed.delete(command)) {
      continue;
    }
    problems.push(
      `The PR adds ${target} to a blocking list, and the base does not observe it. Add it to observedTargets in tools/validate.ts first. Only a rename that keeps the command of the old target skips that step. A split or a replacement does not.`,
    );
  }
  return problems;
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
  const allAdded = listed
    .filter((line) => line.startsWith('A'))
    .map((line) => line.split('\t')[1] ?? '');
  const features = newFeatures(root, base, allAdded);
  if (
    features.length > 0 &&
    !existsSync(path.join(root, 'KICKOFF.md')) &&
    !namesGoal(root, files)
  ) {
    errors.push(
      `The PR adds features/${features.join(', features/')}, and no changed issue has a \`goal:\` from ${intentFile}.`,
    );
  }
  errors.push(...blockingProblems(root, base, head));
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
