import { checkConclusions, readConfig } from '@tools/github/auto-merge';
import { enabledMarker, kindProblem, marker, steps } from '@tools/github/auto-merge-rules';
import type { Config, Pr } from '@tools/github/auto-merge-rules';
import { retrying } from '@tools/github/command';
import { must } from '@tools/github/github';
import { requiredChecks } from '@tools/github/main-checks';
import type { Run } from '@tools/github/stack';

/**
 * The hourly sweep of auto-merge. It dispatches the Auto-merge workflow for each
 * green agent or bot PR that has no verdict for its head, or whose last decide
 * run failed, so a PR opened before a rules change still gets decided. The
 * workflow runs the default branch's rules, so the sweep only chooses PRs.
 * See .agents/skills/deliver/references/pull-requests.md#auto-merge.
 */

/** The most PRs one sweep dispatches. Each one is a workflow run. */
export const sweepCap = 20;

type Listed = Pr & { number: number; isCrossRepository: boolean };

/** One run of the Auto-merge workflow, as `gh run list` gives it. */
type JudgedRun = {
  conclusion: string | null;
  createdAt: string;
  displayTitle: string;
  event: string;
  headSha: string;
  status: string;
};

const gh = (run: Run, ...args: Array<string>) => must(run, ['gh', ...args]);

/** The title that the Auto-merge workflow gives a run that a dispatch started for PR `number`. */
const dispatchTitle = (number: number) => `Auto-merge #${number}`;

/** Whether the PR has a verdict comment for `sha`: a dry-run one, or one that auto-merge was enabled at a step. */
async function hasVerdict(run: Run, repo: string, number: number, sha: string) {
  const bodies = await gh(
    run,
    'api',
    '--paginate',
    `repos/${repo}/issues/${number}/comments`,
    '--jq',
    '.[].body',
  );
  return [marker(sha), ...steps.map((step) => enabledMarker(step, sha))].some((verdict) =>
    bodies.includes(verdict),
  );
}

/**
 * The PR numbers to decide again, least recently decided first, at most
 * `sweepCap`. A PR is chosen when it is an open, ready, same-repository agent
 * or bot PR into the default branch, its required checks have all finished, and
 * either it has no verdict for its head or its last decide run failed. A run
 * still going on it means a decision is under way, so it is skipped.
 */
export async function stalePrs(run: Run, repo: string, defaultBranch: string) {
  const listed = JSON.parse(
    await gh(
      run,
      'pr',
      'list',
      '--state',
      'open',
      '--limit',
      '200',
      '--json',
      'number,state,isDraft,isCrossRepository,baseRefName,headRefName,headRefOid,author',
    ),
  ) as Array<Listed>;
  const runs = JSON.parse(
    await gh(
      run,
      'run',
      'list',
      '--workflow',
      'auto-merge.yml',
      '--limit',
      '500',
      '--json',
      'conclusion,createdAt,displayTitle,event,headSha,status',
    ),
  ) as Array<JudgedRun>;
  const names = await requiredChecks(run, repo, defaultBranch);
  const stale: Array<{ number: number; judgedAt: number }> = [];
  for (const pr of listed) {
    // A fork's PR is never judged, and a person's gets only a refusal, so neither gets a verdict to find.
    if (pr.isCrossRepository || pr.isDraft || pr.baseRefName !== defaultBranch) {
      continue;
    }
    if (kindProblem(pr)) {
      continue;
    }
    const checks = await checkConclusions(run, repo, pr.headRefOid, names);
    if (
      Object.values(checks).some(
        (conclusion) => conclusion === 'pending' || conclusion === 'missing',
      )
    ) {
      continue;
    }
    // A dispatch's run carries the PR number in its title, since its head is the default branch's.
    const judged = runs
      .filter(
        (item) =>
          item.displayTitle === dispatchTitle(pr.number) ||
          (item.event !== 'workflow_dispatch' && item.headSha === pr.headRefOid),
      )
      .toSorted((a, b) => Date.parse(b.createdAt) - Date.parse(a.createdAt));
    if (judged.some((item) => item.status !== 'completed')) {
      continue;
    }
    const failed = judged[0]?.conclusion === 'failure';
    if (!failed && (await hasVerdict(run, repo, pr.number, pr.headRefOid))) {
      continue;
    }
    stale.push({ number: pr.number, judgedAt: judged[0] ? Date.parse(judged[0].createdAt) : 0 });
  }
  return stale
    .toSorted((a, b) => a.judgedAt - b.judgedAt || a.number - b.number)
    .slice(0, sweepCap)
    .map((item) => item.number);
}

/**
 * Dispatches the Auto-merge workflow for each stale PR. A sweep does nothing
 * while `automerge.mode` is `off`, since no verdict would then be posted, so each
 * sweep would dispatch the same PRs again.
 */
export async function sweep(run: Run, config: Config, log: (line: string) => void = console.log) {
  if (config.mode === 'off') {
    log('Auto-merge is off, so the sweep dispatches nothing.');
    return [];
  }
  const repo = await gh(run, 'repo', 'view', '--json', 'nameWithOwner', '--jq', '.nameWithOwner');
  const defaultBranch = await gh(
    run,
    'repo',
    'view',
    '--json',
    'defaultBranchRef',
    '--jq',
    '.defaultBranchRef.name',
  );
  const numbers = await stalePrs(run, repo, defaultBranch);
  for (const number of numbers) {
    await gh(run, 'workflow', 'run', 'auto-merge.yml', '-f', `pr=${number}`);
    log(`Dispatched the decision for #${number}.`);
  }
  if (numbers.length === 0) {
    log('No pull request needs a decision.');
  }
  return numbers;
}

if (import.meta.main) {
  try {
    await sweep(retrying, await readConfig());
    process.exit(0);
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exit(1);
  }
}
