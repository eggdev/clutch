/**
 * The commit that a change is compared with. check-migrations,
 * check-changeset, the pre-push hook and `validate --changed` all use it, so
 * they agree on what "the change" is.
 *
 * `CHECK_BASE` wins when it is set, as CI sets it: `origin/<base>` for a PR and
 * the commit before the push for a push. An all-zero `CHECK_BASE` is the first
 * push of a branch, or a force push, and has no base. Otherwise the base is
 * the merge base of `head` with `origin/HEAD`, then with `origin/main`. A
 * repository with neither has nothing to compare with.
 */
const zero = /^0+$/u;

function git(root: string, ...args: Array<string>): string | null {
  const run = Bun.spawnSync(['git', '-C', root, ...args]);
  return run.exitCode === 0 ? run.stdout.toString().trim() : null;
}

/** The merge base of `head` with the remote default branch, or null without a remote. */
export function defaultBranchBase(root: string, head = 'HEAD'): string | null {
  for (const ref of ['origin/HEAD', 'origin/main']) {
    if (git(root, 'rev-parse', '--verify', '--quiet', `${ref}^{commit}`)) {
      return git(root, 'merge-base', ref, head);
    }
  }
  return null;
}

/** The base commit for the change at `root`, or null when there is none to compare with. */
export function findBase(root: string, env?: string): string | null {
  if (env && zero.test(env)) {
    return null;
  }
  if (env) {
    const base = git(root, 'rev-parse', '--verify', `${env}^{commit}`);
    if (!base) {
      throw new Error(`CHECK_BASE is ${env}, which is not a commit here. Fetch it first.`);
    }
    return base;
  }
  return defaultBranchBase(root);
}

/**
 * The files that differ from `base`: committed, staged, unstaged and
 * untracked. A local run checks the work in progress, not only the commits.
 */
export function changedFiles(root: string, base: string): Array<string> | null {
  const tracked = git(root, 'diff', '--name-only', '--no-renames', base);
  const untracked = git(root, 'ls-files', '--others', '--exclude-standard');
  if (tracked === null || untracked === null) {
    return null;
  }
  return [...new Set([...tracked.split('\n'), ...untracked.split('\n')].filter(Boolean))];
}
