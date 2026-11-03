import type { Run } from '@tools/github/stack';

/**
 * The required checks of the default branch, and whether a check is red, as
 * auto-merge judges them. auto-merge.ts keeps its `requiredChecks` and
 * `checkConclusions` private, and it is in the one-way-door tier, so they are
 * copied here. Change both together: auto-merge and auto-revert must judge main
 * by the same checks.
 */

/** The check that agent review reports. auto-merge counts it as required too. */
const agentReview = 'agent-review';

/** A conclusion that makes a check red. The same set as auto-merge. */
const redConclusions = new Set([
  'failure',
  'timed_out',
  'cancelled',
  'action_required',
  'startup_failure',
]);

/** The latest run of one check on a commit. `conclusion` stays null until it completes. */
export type CheckRun = { status: string; conclusion: string | null };

async function gh(run: Run, ...args: Array<string>) {
  const command = ['gh', ...args];
  const result = await run(command);
  if (!result.ok) {
    throw new Error(`${command.join(' ')} failed: ${result.err || result.out}`);
  }
  return result.out.trim();
}

/** The required status checks of `branch`, plus agent review. */
export async function requiredChecks(run: Run, repo: string, branch: string) {
  const out = await gh(
    run,
    'api',
    `repos/${repo}/rules/branches/${branch}`,
    '--jq',
    '[.[] | select(.type == "required_status_checks") | .parameters.required_status_checks[].context]',
  );
  return [...new Set([...(JSON.parse(out) as Array<string>), agentReview])];
}

/**
 * The latest job of each check on commit `sha`, from the workflow runs of a push
 * to `branch`. A check run's name is its job's name. This reads the Actions runs
 * rather than the check runs, because the Auto-revert job's token has no
 * `checks: read`, and only the GitHub Actions app writes these runs, so a token
 * with checks: write cannot fake one. A later attempt of a run replaces an
 * earlier one, as the latest job id does.
 */
export async function latestChecks(run: Run, repo: string, branch: string, sha: string) {
  const ids = await gh(
    run,
    'api',
    '--paginate',
    `repos/${repo}/actions/runs?head_sha=${sha}&event=push&per_page=100`,
    '--jq',
    `.workflow_runs[] | select(.head_branch == "${branch}") | .id`,
  );
  const runIds = ids.split('\n').filter(Boolean);
  const latest = new Map<string, { id: number } & CheckRun>();
  for (const runId of runIds) {
    const out = await gh(
      run,
      'api',
      '--paginate',
      `repos/${repo}/actions/runs/${runId}/jobs?filter=latest&per_page=100`,
      '--jq',
      '.jobs[] | {id, name, status, conclusion}',
    );
    for (const line of out.split('\n').filter(Boolean)) {
      const job = JSON.parse(line) as { id: number; name: string } & CheckRun;
      if ((latest.get(job.name)?.id ?? -1) < job.id) {
        latest.set(job.name, job);
      }
    }
  }
  return new Map<string, CheckRun>(
    [...latest].map(([name, { status, conclusion }]) => [name, { status, conclusion }]),
  );
}

/** Whether a check is red. A check that has not completed is not red. A check that never ran is not red. */
export function isRed(check: CheckRun | undefined) {
  return (
    check !== undefined &&
    check.status === 'completed' &&
    redConclusions.has(check.conclusion ?? '')
  );
}
