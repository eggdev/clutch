import { parseArgs } from 'node:util';

import { readConfig } from '@tools/github/auto-merge';
import { kindProblem } from '@tools/github/auto-merge-rules';
import type { Config, Pr } from '@tools/github/auto-merge-rules';
import { retrying } from '@tools/github/command';
import { must } from '@tools/github/github';
import { requiredChecks } from '@tools/github/main-checks';
import type { Run } from '@tools/github/stack';

/**
 * The sweep of auto-merge: it dispatches the Auto-merge workflow for the PRs
 * that need a decision. `schedule` is the hourly sweep. A PR that is held,
 * because its decide job succeeded after its last required check finished, is
 * left alone until its head changes, or until its last decide fails. `push` is a
 * push to main that changes an auto-merge rule: each eligible PR's last decision
 * used the old rules, so every one is dispatched again. The workflow runs the
 * default branch's rules, so the sweep only chooses PRs.
 * See .agents/skills/deliver/references/pull-requests.md#auto-merge.
 */

/** The most PRs one sweep dispatches. Each one is a workflow run. */
export const sweepCap = 20;

/** `schedule` for the hourly sweep, and `push` for a push to main that changes a rule. */
export type Mode = 'schedule' | 'push';

/** The newest runs of a head whose decide job the hourly sweep reads. The latest decides, and a success just before it. */
const newestRuns = 5;

type Listed = Pr & { number: number; isCrossRepository: boolean };

/** One run of the Auto-merge workflow, as `gh run list` gives it. */
type JudgedRun = {
  conclusion: string | null;
  createdAt: string;
  databaseId: number;
  displayTitle: string;
  event: string;
  headSha: string;
  status: string;
};

const gh = (run: Run, ...args: Array<string>) => must(run, ['gh', ...args]);

/** The title that the Auto-merge workflow gives a run that a dispatch started for PR `number`. */
const dispatchTitle = (number: number) => `Auto-merge #${number}`;

/** The app that runs the workflows, and so reports each required check. */
const actionsApp = 'github-actions';

/**
 * When every required check of `sha` has finished, the time, in milliseconds,
 * that the last one did. Null while one runs or is missing. As in
 * auto-merge, the latest run of each name counts, and only the Actions app's.
 */
export async function checksDoneAt(
  run: Run,
  repo: string,
  sha: string,
  names: Array<string>,
): Promise<number | null> {
  const out = await gh(
    run,
    'api',
    '--paginate',
    `repos/${repo}/commits/${sha}/check-runs?per_page=100`,
    '--jq',
    '.check_runs[] | {id, name, status, completed_at, app: .app.slug}',
  );
  const latest = new Map<string, { id: number; status: string; completed_at: string | null }>();
  for (const line of out.split('\n').filter(Boolean)) {
    const item = JSON.parse(line) as {
      id: number;
      name: string;
      status: string;
      completed_at: string | null;
      app: string | null;
    };
    if (item.app !== actionsApp) {
      continue;
    }
    if ((latest.get(item.name)?.id ?? -1) < item.id) {
      latest.set(item.name, item);
    }
  }
  let last: number | null = null;
  for (const name of names) {
    const found = latest.get(name);
    if (!found || found.status !== 'completed' || !found.completed_at) {
      return null;
    }
    last = Math.max(last ?? 0, Date.parse(found.completed_at));
  }
  return last;
}

/**
 * The decide job of run `id`: its conclusion, and when it started in
 * milliseconds. Null when the run has no decide job. The run's own
 * conclusion is not used, since a run whose decide job was skipped did not decide.
 * A decide job whose Decide step was skipped found no PR to judge, so it did
 * not decide either, and counts as skipped.
 */
async function decideJob(run: Run, repo: string, id: number) {
  const out = await gh(
    run,
    'api',
    '--paginate',
    `repos/${repo}/actions/runs/${id}/jobs`,
    '--jq',
    '.jobs[] | select(.name == "decide") | [.conclusion, .started_at, ([.steps[]? | select(.name == "Decide") | .conclusion][0] // "")] | @tsv',
  );
  const line = out.split('\n').find(Boolean);
  if (!line) {
    return null;
  }
  const [conclusion, startedAt, step] = line.split('\t');
  return {
    conclusion: step === 'skipped' ? 'skipped' : conclusion || null,
    startedAt: Date.parse(startedAt),
  };
}

/**
 * The PR numbers to dispatch, least recently decided first, at most `sweepCap`.
 * A PR is eligible when it is an open, ready, same-repository agent or bot PR
 * into the default branch, and its required checks have all finished. In
 * `push` mode every eligible PR is chosen. In `schedule` mode an eligible PR is
 * chosen unless it is held: no decide job of its head succeeded after its last
 * check finished, or the latest decide job failed. A run still going on the
 * head means a decision is under way, so the PR is skipped.
 */
export async function stalePrs(run: Run, repo: string, defaultBranch: string, mode: Mode) {
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
      'conclusion,createdAt,databaseId,displayTitle,event,headSha,status',
    ),
  ) as Array<JudgedRun>;
  const names = await requiredChecks(run, repo, defaultBranch);
  const chosen: Array<{ number: number; judgedAt: number }> = [];
  for (const pr of listed) {
    // A fork's PR is never judged, and a person's gets only a refusal, so neither is eligible.
    if (pr.isCrossRepository || pr.isDraft || pr.baseRefName !== defaultBranch) {
      continue;
    }
    if (kindProblem(pr)) {
      continue;
    }
    const doneAt = await checksDoneAt(run, repo, pr.headRefOid, names);
    if (doneAt === null) {
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
    const judgedAt = judged[0] ? Date.parse(judged[0].createdAt) : 0;
    if (mode === 'push') {
      chosen.push({ number: pr.number, judgedAt });
      continue;
    }
    if (judged.some((item) => item.status !== 'completed')) {
      continue;
    }
    // A decide that started after the last check finished read the checks as
    // finished. One that started before may have read them still running, so it
    // does not hold the PR.
    const decides = [];
    for (const item of judged.slice(0, newestRuns)) {
      decides.push(await decideJob(run, repo, item.databaseId));
    }
    const failed = decides[0]?.conclusion === 'failure';
    const held = decides.some((job) => job?.conclusion === 'success' && job.startedAt >= doneAt);
    if (!failed && held) {
      continue;
    }
    chosen.push({ number: pr.number, judgedAt });
  }
  return chosen
    .toSorted((a, b) => a.judgedAt - b.judgedAt || a.number - b.number)
    .slice(0, sweepCap)
    .map((item) => item.number);
}

/**
 * Dispatches the Auto-merge workflow for each chosen PR. A sweep does nothing
 * while `automerge.mode` is `off`, since no decision would then post anything,
 * so each sweep would dispatch the same PRs again.
 */
export async function sweep(
  run: Run,
  config: Config,
  mode: Mode,
  log: (line: string) => void = console.log,
) {
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
  const numbers = await stalePrs(run, repo, defaultBranch, mode);
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
    // The workflow passes its event. A push to main is the push mode; anything else is the hourly sweep.
    const { values } = parseArgs({
      args: process.argv.slice(2),
      options: { event: { type: 'string' } },
    });
    await sweep(retrying, await readConfig(), values.event === 'push' ? 'push' : 'schedule');
    process.exit(0);
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exit(1);
  }
}
