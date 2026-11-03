import {
  blockers,
  brake,
  brakeReason,
  brakedStep,
  verdictText,
} from '@tools/github/auto-merge-rules';
import type { Facts, Step } from '@tools/github/auto-merge-rules';
import type { Run } from '@tools/github/stack';

/**
 * The revert brake for one auto-merge run: counts the PRs that merged in the
 * brake's window and how many revert another, then steps the configured step
 * down when reverts pass the limit. The rule is in auto-merge-rules.ts.
 */

/** The first day of the brake's window, as `YYYY-MM-DD` in UTC. The window is whole days, such as `30d`. */
function brakeSince(now: Date) {
  const days = Number(brake.window.replace(/d$/u, ''));
  return new Date(now.getTime() - days * 86_400_000).toISOString().slice(0, 10);
}

/** How many PRs merged in the window, and how many of them revert another PR. Throws when GitHub cannot list them. */
async function mergedInWindow(run: Run) {
  const result = await run([
    'gh',
    'pr',
    'list',
    '--state',
    'merged',
    '--search',
    `merged:>=${brakeSince(new Date())}`,
    '--limit',
    '1000',
    '--json',
    'headRefName',
  ]);
  if (!result.ok) {
    throw new Error(`gh pr list failed: ${result.err || result.out}`);
  }
  const prs = JSON.parse(result.out) as Array<{ headRefName: string }>;
  return {
    merged: prs.length,
    reverts: prs.filter((pr) => pr.headRefName.startsWith('revert/')).length,
  };
}

/**
 * The step that a run judges at, after the brake, and the note for the verdict
 * when the brake steps down. A failed count does not brake: the run keeps the
 * configured step, and a `::warning::` says so.
 */
async function judgedStep(run: Run, step: Step, log: (line: string) => void) {
  try {
    const { merged, reverts } = await mergedInWindow(run);
    const effective = brakedStep(step, merged, reverts);
    return {
      effective,
      note: effective === step ? undefined : brakeReason(merged, reverts, step, effective),
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    log(
      `::warning::Could not count the merged PRs for the revert brake, so the step stays ${step}: ${message}`,
    );
    return { effective: step, note: undefined };
  }
}

/**
 * Judges a PR at the step that the brake allows: the reasons it may not merge
 * there, and the verdict that a run prints, with the brake's note when it steps down.
 */
export async function judgeAtStep(run: Run, facts: Facts, step: Step, log: (line: string) => void) {
  const { effective, note } = await judgedStep(run, step, log);
  const reasons = blockers(facts, effective);
  const verdict = [note, verdictText(reasons, effective)].filter(Boolean).join('\n');
  return { effective, reasons, verdict };
}
