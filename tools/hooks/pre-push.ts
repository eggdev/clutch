import { isDocsOnly } from '@tools/hooks/paths.mjs';

/**
 * Git passes one line per pushed ref on stdin:
 * `<local ref> <local sha> <remote ref> <remote sha>`. A zero sha means a
 * deleted ref (local) or a new branch (remote).
 */
export type PushedRef = { localSha: string; remoteSha: string };
const zero = /^0+$/;

export const parsePushedRefs = (stdin: string): PushedRef[] =>
  stdin
    .split('\n')
    .map((line) => line.trim().split(/\s+/))
    .filter((parts) => parts.length === 4)
    .map(([, localSha, , remoteSha]) => ({ localSha, remoteSha }));

const git = (...args: string[]) => {
  const run = Bun.spawnSync(['git', ...args]);
  return run.exitCode === 0 ? run.stdout.toString().trim() : null;
};

/** The paths that each pushed ref changes, or null when Git cannot list them. */
export function changedPaths(refs: PushedRef[]): string[] | null {
  const paths: string[] = [];
  for (const { localSha, remoteSha } of refs) {
    if (zero.test(localSha)) continue;
    const base = zero.test(remoteSha)
      ? (git('merge-base', localSha, 'origin/HEAD') ?? git('merge-base', localSha, 'origin/main'))
      : remoteSha;
    const listed = base
      ? git('diff', '--name-only', base, localSha)
      : git('ls-tree', '-r', '--name-only', localSha);
    if (listed === null) return null;
    paths.push(...listed.split('\n').filter(Boolean));
  }
  return paths;
}

/**
 * The Nx targets for a push. A docs-only push can still break a docs check. A
 * push that changes no path, such as a branch deletion, runs nothing. When Git
 * cannot list the paths (null), everything runs.
 */
export function pushTargets(paths: string[] | null): string[] {
  if (paths?.length === 0) return [];
  return paths?.every(isDocsOnly) ? ['checks'] : ['test', 'lint-policy-test', 'checks'];
}

if (import.meta.main) {
  const targets = pushTargets(changedPaths(parsePushedRefs(await Bun.stdin.text())));
  if (!targets.length) process.exit(0);
  console.log(`pre-push: nx run-many -t ${targets.join(' ')}`);
  const run = Bun.spawnSync([process.execPath, 'x', 'nx', 'run-many', '-t', ...targets], {
    env: { ...process.env, CI: '1' },
    stdout: 'inherit',
    stderr: 'inherit',
  });
  if (run.exitCode !== 0) {
    console.error(
      'pre-push: a check failed. Fix it, then push again. Never push with --no-verify.',
    );
    process.exit(1);
  }
}
