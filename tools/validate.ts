/**
 * Runs Nx targets for `validate`, `check` and the pre-push hook, so each one
 * prints a failing task's full output inline. Nx 23 picks the `summary` style
 * when an AI agent runs it, and that style leaves each failure in a file under
 * ~/.nx. Clutch syncs this file, so a project gets changes here without a
 * decision on its package.json scripts. See docs/contributing/setup/checks.md#validate.
 */

/** Every target that `validate` runs. CI runs the same list. */
export const validateTargets = [
  'typecheck',
  'test',
  'lint',
  'format-check',
  'lint-policy-test',
  'skill-tests',
  'audit-prod',
  'checks',
];

/** The quick subset that `check` runs. */
export const checkTargets = ['typecheck', 'lint', 'format-check'];

/** The `nx` arguments that run `targets` and print only failing tasks in full. */
export const runManyArgs = (targets: Array<string>) => [
  'run-many',
  '--outputStyle=static-failures-only',
  '-t',
  ...targets,
];

/** Runs `targets` with Nx and returns its exit code. */
export function runTargets(targets: Array<string>, env: Record<string, string | undefined>) {
  return Bun.spawnSync([process.execPath, 'x', 'nx', ...runManyArgs(targets)], {
    env,
    stdout: 'inherit',
    stderr: 'inherit',
  }).exitCode;
}

if (import.meta.main) {
  const quick = process.argv.includes('--quick');
  // CI=1 for validate, so its Nx cache keys match CI's. See docs/contributing/setup/nx.md#cache-keys.
  const env = quick ? process.env : { ...process.env, CI: '1' };
  process.exit(runTargets(quick ? checkTargets : validateTargets, env));
}
