import { changedFiles, findBase } from '@tools/check-base';
import { isDocsOnly } from '@tools/hooks/paths.mjs';

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

/**
 * The time a `validate --changed` run should take, in seconds. Above it, the
 * run warns. Provisional until CL-303 measures the p50 on a CI runner.
 */
export const changedBudgetSeconds = 60;

/** The quick subset that `check` runs. */
export const checkTargets = ['typecheck', 'lint', 'format-check'];

/** The `nx` arguments that run `targets` and print only failing tasks in full. */
export const runManyArgs = (targets: Array<string>) => [
  'run-many',
  '--outputStyle=static-failures-only',
  '-t',
  ...targets,
];

function runNx(args: Array<string>, env: Record<string, string | undefined>) {
  return Bun.spawnSync([process.execPath, 'x', 'nx', ...args], {
    env,
    stdout: 'inherit',
    stderr: 'inherit',
  }).exitCode;
}

/** Runs `targets` with Nx and returns its exit code. */
export function runTargets(targets: Array<string>, env: Record<string, string | undefined>) {
  return runNx(runManyArgs(targets), env);
}

/**
 * What `validate --changed` runs for the files that differ from the base.
 * Without a base or a file list, everything runs. A docs-only change runs the
 * root checks. Any other change runs the validate targets of the affected Nx
 * projects, and the root checks, which read the whole tree.
 */
export function changedPlan(base: string | null, files: Array<string> | null) {
  if (base === null || files === null) {
    return { kind: 'full' as const, steps: [runManyArgs(validateTargets)] };
  }
  if (files.length === 0) {
    return { kind: 'none' as const, steps: [] };
  }
  const checks = runManyArgs(['checks']);
  if (files.every(isDocsOnly)) {
    return { kind: 'docs' as const, steps: [checks] };
  }
  const affected = validateTargets.filter((target) => target !== 'checks');
  return {
    kind: 'affected' as const,
    steps: [
      ['affected', `--base=${base}`, '--outputStyle=static-failures-only', '-t', ...affected],
      checks,
    ],
  };
}

/** Runs the plan for the change at `root` and reports the time against the budget. */
function validateChanged(root: string, explicitBase: string | undefined) {
  const base = findBase(root, explicitBase ?? process.env.CHECK_BASE);
  const plan = changedPlan(base, base === null ? null : changedFiles(root, base));
  const why = {
    full: 'no base to compare with, so everything runs',
    none: 'nothing changed',
    docs: 'a docs-only change, so only the root checks run',
    affected: `the affected projects since ${base?.slice(0, 7)}, and the root checks`,
  }[plan.kind];
  console.log(`validate --changed: ${why}.`);
  const started = performance.now();
  const env = { ...process.env, CI: '1' };
  let code = 0;
  // Every step runs, so one report shows each failure.
  for (const step of plan.steps) {
    const exit = runNx(step, env) ?? 1;
    code ||= exit;
  }
  const seconds = Math.round((performance.now() - started) / 1000);
  console.log(`validate --changed took ${seconds} s (budget ${changedBudgetSeconds} s).`);
  if (seconds > changedBudgetSeconds) {
    console.log(
      `::warning title=Over the check budget::validate --changed took ${seconds} s, more than ${changedBudgetSeconds} s.`,
    );
  }
  return code;
}

if (import.meta.main) {
  const args = process.argv.slice(2);
  if (args.includes('--changed')) {
    const at = args.indexOf('--base');
    process.exit(validateChanged(process.cwd(), at === -1 ? undefined : args[at + 1]));
  }
  const quick = args.includes('--quick');
  // CI=1 for validate, so its Nx cache keys match CI's. See docs/contributing/setup/nx.md#cache-keys.
  const env = quick ? process.env : { ...process.env, CI: '1' };
  process.exit(runTargets(quick ? checkTargets : validateTargets, env));
}
