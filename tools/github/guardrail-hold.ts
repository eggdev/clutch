import { must } from '@tools/github/auto-merge-enable';
import type { Run } from '@tools/github/stack';
import { guardrailList } from '@tools/guardrail-files';
import type { GuardrailList } from '@tools/guardrail-files';

/**
 * The hold on a guardrail change. An agent that cannot pass a check must not
 * change the check and merge. So the merge judge holds a pull request that
 * changes a file of `held` in tools/guardrail-files.json, unless the issue of
 * its branch names that file in its `## Files` section. The judge reads the
 * list and the issue from the default branch, never from the pull request, so
 * a pull request cannot allow itself. The owner's approval lifts the hold, see
 * `blockers` in tools/github/auto-merge-rules.ts.
 *
 * A new file sets no rule that exists yet, and a test file sets none, so
 * neither holds. A change to the list holds only when it makes the list weaker.
 * See docs/contributing/harness-engineering.md#guardrail-files.
 */

const testFile = /\.test\.[cm]?[jt]sx?$/u;

/** The paths in the `## Files` section of an issue: each text in backticks. */
export function issueFiles(text: string) {
  const section = /^## Files[ \t]*\n([\s\S]*?)(?=^## |(?![\s\S]))/mu.exec(text)?.[1] ?? '';
  return new Set([...section.matchAll(/`([^`\n]+)`/gu)].map((match) => match[1]));
}

/** Whether `after` lacks a pattern of `before`. */
const dropped = (before: Array<string> = [], after: Array<string> = []) =>
  before.some((pattern) => !after.includes(pattern));

/**
 * Whether the head list is weaker than the base list: it drops a pattern or a
 * held pattern, or it exempts a new file. A new pattern or a new description
 * is not weaker.
 */
export function weakerList(base: GuardrailList, head: GuardrailList) {
  const exempted = Object.keys(head.exempt ?? {}).some(
    (file) => !Object.hasOwn(base.exempt ?? {}, file),
  );
  return dropped(base.patterns, head.patterns) || dropped(base.held, head.held) || exempted;
}

/** A file at `ref`, or undefined when git cannot show it. */
async function show(run: Run, ref: string, file: string) {
  const result = await run(['git', 'show', `${ref}:${file}`]);
  return result.ok ? result.out : undefined;
}

const parseList = (text: string | undefined): GuardrailList =>
  text ? (JSON.parse(text) as GuardrailList) : { patterns: [] };

/** Each held file that the pull request at `sha` changes, from the merge base. */
async function heldChanges(run: Run, main: string, sha: string, held: Array<string>) {
  const globs = held.map((pattern) => new Bun.Glob(pattern));
  const base = await must(run, ['git', 'merge-base', main, sha]);
  const listed = await must(run, ['git', 'diff', '--name-status', '-M', base, sha]);
  const files: Array<string> = [];
  for (const line of listed.split('\n').filter(Boolean)) {
    // A rename takes the rule away from the old path, so the old path counts.
    const [status = '', before = ''] = line.split('\t');
    if (status === 'A' || testFile.test(before) || !globs.some((glob) => glob.match(before))) {
      continue;
    }
    if (before === guardrailList && status === 'M') {
      const [old, now] = [await show(run, base, before), await show(run, sha, before)];
      if (!weakerList(parseList(old), parseList(now))) {
        continue;
      }
    }
    files.push(before);
  }
  return files;
}

/**
 * Why the pull request at `sha` holds for a guardrail change, or nothing.
 * `issue` is the id that its branch names, such as `CL-494`, when it names one.
 */
export async function guardrailHolds(run: Run, defaultBranch: string, sha: string, issue?: string) {
  const main = `origin/${defaultBranch}`;
  const held = parseList(await show(run, main, guardrailList)).held ?? [];
  if (held.length === 0) {
    return [];
  }
  const changed = await heldChanges(run, main, sha, held);
  if (changed.length === 0) {
    return [];
  }
  const text = issue ? await show(run, main, `.clutch/issues/${issue}.md`) : undefined;
  const named = issueFiles(text ?? '');
  const unnamed = changed.filter((file) => !named.has(file));
  if (unnamed.length === 0) {
    return [];
  }
  const files = unnamed.map((file) => `\`${file}\``).join(', ');
  const it = unnamed.length === 1 ? 'it' : 'them';
  let why = 'the branch names no issue';
  if (issue) {
    why =
      text === undefined
        ? `${issue} is not on ${defaultBranch}`
        : `the \`## Files\` section of ${issue} on ${defaultBranch} does not name ${it}`;
  }
  const fix = issue
    ? `first merge a change to ${issue} that names ${it} under \`## Files\`, then merge ${defaultBranch} into this branch`
    : `deliver the change on the branch of an issue on ${defaultBranch} whose \`## Files\` section names ${it}`;
  return [
    `The PR changes the guardrail file ${files}, which sets a check, a lint rule, a budget or a hook, and ${why}. Take the change out of this PR, or ${fix}. The owner's approval also lifts this hold.`,
  ];
}
