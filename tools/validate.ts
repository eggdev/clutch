import { availableParallelism } from 'node:os';

import { changedFiles, findBase } from '@tools/check-base';
import { clearFindings, findingChecks, readFindings } from '@tools/findings';
import type { Finding } from '@tools/findings';
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
 * Each observed check target. `validate` runs each one after the blocking
 * targets, and prints a finding as a warning. An observed check never changes
 * the exit code. A new check starts here, and a later pull request moves it to
 * a blocking list. check-scope holds that rule. See
 * docs/contributing/setup/checks.md#observed-checks.
 */
export const observedTargets: Array<string> = [];

/**
 * The time a `validate --changed` run should take, in seconds. Above it, the
 * run warns. Measured on the 4-core GitHub runner on 2026-10-31 (CL-303): the
 * validate step's p50 was 64 s for the full run over 5 PRs, and 50 s for
 * --changed on a small PR. The budget leaves 20% over that.
 */
export const changedBudgetSeconds = 60;

/** The cores at which `validate --changed` runs its steps at once. */
const parallelCores = 8;

/** The quick subset that `check` runs. */
export const checkTargets = ['typecheck', 'lint', 'format-check'];

/** The `nx` arguments that run `targets` and print only failing tasks in full. */
export const runManyArgs = (targets: Array<string>) => [
  'run-many',
  '--outputStyle=static-failures-only',
  '-t',
  ...targets,
];

/** Runs Nx. `stdout` is `inherit`, or 2 to send its output to standard error. */
function runNx(
  args: Array<string>,
  env: Record<string, string | undefined>,
  stdout: 'inherit' | 2 = 'inherit',
) {
  return Bun.spawnSync([process.execPath, 'x', 'nx', ...args], {
    env,
    stdout,
    stderr: 'inherit',
  }).exitCode;
}

/** Runs `targets` with Nx and returns its exit code. */
export function runTargets(targets: Array<string>, env: Record<string, string | undefined>) {
  return runNx(runManyArgs(targets), env);
}

/**
 * The time limit of one observed check, in seconds. A check runs in seconds,
 * and the whole blocking run takes about 64 s (CL-303). A check that runs for
 * 5 minutes hangs, so the limit stops it and validate goes on.
 */
export const observedLimitSeconds = 300;

/** How one observed check ended: an exit code, or the signal that stopped it. */
export type ObservedEnd = number | { signal: string; timedOut?: boolean };

/** Text for a GitHub workflow command. A title also encodes `:` and `,`. */
export function escapeAnnotation(text: string, title = false) {
  const escaped = text.replaceAll('%', '%25').replaceAll('\r', '%0D').replaceAll('\n', '%0A');
  return title ? escaped.replaceAll(':', '%3A').replaceAll(',', '%2C') : escaped;
}

/** The warning for an observed check that would block. In CI it is a warning annotation. */
export function observedWarning(target: string, why: string, ci: boolean) {
  const text = `${target} would block: ${why}. It is observed, so validate still passes.`;
  return ci
    ? `::warning title=${escapeAnnotation(`Observed check ${target}`, true)}::${escapeAnnotation(text)}`
    : `Warning: ${text}`;
}

/** Why an observed check that ended with `end` would block, or null when it passed. */
function failure(end: ObservedEnd) {
  if (typeof end === 'number') {
    return end === 0 ? null : `it exited with code ${end}`;
  }
  return end.timedOut
    ? `it ran past the limit of ${observedLimitSeconds} s, so validate stopped it`
    : `the signal ${end.signal} ended it`;
}

/**
 * Runs each observed target with `run`, and prints a warning for each that
 * fails, crashes or runs past its limit. A heading comes first, and the result
 * of the blocking targets comes last. Returns `blocking`, their exit code, so
 * an observed check never changes the result. With no observed targets, it
 * runs nothing and prints nothing.
 */
export function runObserved(
  blocking: number,
  targets: ReadonlyArray<string>,
  run: (target: string) => ObservedEnd,
  print: (line: string) => void = console.log,
  ci = Boolean(process.env.GITHUB_ACTIONS),
) {
  if (targets.length === 0) {
    return blocking;
  }
  print('Observed checks (they never block):');
  for (const target of targets) {
    let why: string | null;
    try {
      why = failure(run(target));
    } catch (error) {
      why = `it crashed: ${error instanceof Error ? error.message : String(error)}`;
    }
    if (why !== null) {
      print(observedWarning(target, why, ci));
    }
  }
  print(
    `The blocking checks ${blocking === 0 ? 'passed' : 'failed'}, so validate exits with code ${blocking}.`,
  );
  return blocking;
}

/** Runs one observed target with Nx, inside its time limit. */
export const runObservedTarget =
  (env: Record<string, string | undefined>, cwd?: string, limitSeconds = observedLimitSeconds) =>
  (target: string): ObservedEnd => {
    const run = Bun.spawnSync([process.execPath, 'x', 'nx', ...runManyArgs([target])], {
      env,
      cwd,
      stdout: 'inherit',
      stderr: 'inherit',
      timeout: limitSeconds * 1000,
    });
    // Nx can catch the signal of the limit and exit with a code, so check the limit first.
    if (run.exitedDueToTimeout) {
      return { signal: String(run.signalCode ?? 'SIGTERM'), timedOut: true };
    }
    // Bun types exitCode as a number, but a signal leaves it null.
    return run.signalCode ? { signal: String(run.signalCode) } : run.exitCode;
  };

/**
 * The step that `validate` and `validate --changed` both run after the
 * blocking targets: each observed target with Nx. Returns `blocking`.
 */
export function observe(
  blocking: number,
  env: Record<string, string | undefined>,
  options: { targets?: ReadonlyArray<string>; cwd?: string; limitSeconds?: number } = {},
  print: (line: string) => void = console.log,
) {
  return runObserved(
    blocking,
    options.targets ?? observedTargets,
    runObservedTarget(env, options.cwd, options.limitSeconds),
    print,
  );
}

/**
 * The document that `validate --json` prints. `checks` names each check that
 * reported findings as data in this run, so a reader knows what the list
 * covers. `missing` names each check of `expected` that wrote no findings: it
 * stopped before the end, so it did not find nothing. A check that has not
 * moved to findings yet prints only text, and `exitCode` still counts it.
 */
export function findingsDocument(
  exitCode: number,
  byCheck: Record<string, Array<Finding>>,
  expected: ReadonlyArray<string> = findingChecks,
) {
  return {
    exitCode,
    checks: Object.keys(byCheck),
    missing: expected.filter((check) => !(check in byCheck)),
    findings: Object.values(byCheck).flat(),
  };
}

/**
 * Runs the validate targets and prints one JSON document of findings on
 * standard output. Nx prints to standard error, so standard output holds only
 * the document. Each moved check writes its findings to a file, because Nx
 * runs each check in a process of its own. See
 * docs/contributing/setup/checks.md#findings.
 */
function validateJson(root: string, env: Record<string, string | undefined>) {
  clearFindings(root);
  const exitCode = runNx(runManyArgs(validateTargets), env, 2);
  console.log(JSON.stringify(findingsDocument(exitCode, readFindings(root)), null, 2));
  return exitCode;
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
async function validateChanged(root: string, explicitBase: string | undefined) {
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
  // Each step runs to the end, so one report shows each failure. On a machine
  // with many cores the steps run at once. On a small CI runner they would
  // starve each other, and a timed test fails, so they run in turn.
  const start = (step: Array<string>) =>
    Bun.spawn([process.execPath, 'x', 'nx', ...step], {
      env,
      stdout: 'inherit',
      stderr: 'inherit',
    });
  const exits: Array<number> = [];
  if (availableParallelism() >= parallelCores) {
    exits.push(...(await Promise.all(plan.steps.map((step) => start(step).exited))));
  } else {
    for (const step of plan.steps) {
      exits.push(await start(step).exited);
    }
  }
  const code = observe(exits.find((exit) => exit !== 0) ?? 0, env, {
    targets: plan.kind === 'none' ? [] : observedTargets,
  });
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
  if (args.includes('--json')) {
    if (args.includes('--changed') || args.includes('--quick')) {
      console.error('validate --json runs every target. Run it without --changed and --quick.');
      process.exit(2);
    }
    process.exit(validateJson(process.cwd(), { ...process.env, CI: '1' }));
  }
  if (args.includes('--changed')) {
    const at = args.indexOf('--base');
    process.exit(await validateChanged(process.cwd(), at === -1 ? undefined : args[at + 1]));
  }
  const quick = args.includes('--quick');
  // CI=1 for validate, so its Nx cache keys match CI's. See docs/contributing/setup/nx.md#cache-keys.
  const env = quick ? process.env : { ...process.env, CI: '1' };
  if (quick) {
    process.exit(runTargets(checkTargets, env));
  }
  process.exit(observe(runTargets(validateTargets, env), env));
}
