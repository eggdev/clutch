import path from 'node:path';
import { parseArgs } from 'node:util';

import type { Run } from '@tools/github/stack';

/**
 * When CI fails on the default branch right after a green run, finds the pull
 * request that broke it. When auto-merge merged that PR, this labels it
 * `revert` and starts the Revert workflow, which opens the revert PR. A first
 * failure only reruns the failed jobs, so a flaky test does not revert a PR.
 * A PR that a person merged gets no automatic revert: the person who merged it
 * owns the fix. See https://github.com/eggdev/clutch/blob/main/docs/contributing/operations/rollback.md#auto-revert.
 */
const usage =
  'Usage: bun tools/github/auto-revert.ts --sha <head> --branch <default branch> --run-id <id> --attempt <n> [--workflow ci.yml]';

const root = path.resolve(import.meta.dir, '../..');

/** The start of the comment that auto-merge posts when it queues a merge. */
export const enabledMarker = '<!-- automerge-enabled:';

/** The release commit that the Release workflow pushes after each merge. */
const releaseCommit = /^chore\(release\)/u;

async function must(run: Run, command: Array<string>) {
  const result = await run(command);
  if (!result.ok) {
    throw new Error(`${command.join(' ')} failed: ${result.err || result.out}`);
  }
  return result.out.trim();
}

/**
 * Whether auto-merge merged `pr`: a bot posted the enabled marker on it. Only a
 * bot's comment counts, so a person cannot mark a PR as auto-merged.
 */
export async function autoMerged(run: Run, repo: string, pr: string) {
  const out = await must(run, [
    'gh',
    'api',
    '--paginate',
    `repos/${repo}/issues/${pr}/comments`,
    '--jq',
    `.[] | select(.user.type == "Bot" and (.body | contains("${enabledMarker}"))) | .id`,
  ]);
  return out.length > 0;
}

type CiRun = { headSha: string; conclusion: string; status: string };

/**
 * The conclusion of the last finished push run of CI on the branch before the
 * run for `sha`. A cancelled or skipped run says nothing, so it is passed over.
 */
export function previousConclusion(runs: Array<CiRun>, sha: string) {
  const index = runs.findIndex((ciRun) => ciRun.headSha === sha);
  const before = index === -1 ? [] : runs.slice(index + 1);
  return (
    before.find(
      (ciRun) => ciRun.status === 'completed' && ['success', 'failure'].includes(ciRun.conclusion),
    )?.conclusion ?? null
  );
}

/** Runs the check. Returns the exit code. */
export async function runAutoRevert(
  args: Array<string>,
  run: Run,
  options: { log?: (text: string) => void; env?: Record<string, string | undefined> } = {},
): Promise<number> {
  const { log = console.log } = options;
  const env = options.env ?? process.env;
  const { values } = parseArgs({
    args,
    options: {
      sha: { type: 'string' },
      branch: { type: 'string' },
      'run-id': { type: 'string' },
      attempt: { type: 'string' },
      workflow: { type: 'string', default: 'ci.yml' },
    },
  });
  const { sha, branch, attempt, workflow } = values;
  const runId = values['run-id'];
  const repo = env.GITHUB_REPOSITORY;
  if (!sha || !branch || !runId || !attempt || !repo) {
    throw new Error(usage);
  }
  const runs = JSON.parse(
    await must(run, [
      'gh',
      'run',
      'list',
      '--repo',
      repo,
      '--workflow',
      workflow,
      '--branch',
      branch,
      '--event',
      'push',
      '--limit',
      '20',
      '--json',
      'headSha,conclusion,status',
    ]),
  ) as Array<CiRun>;
  const before = previousConclusion(runs, sha);
  if (before !== 'success') {
    log(
      `${branch} was not green before ${sha.slice(0, 7)} (${before ?? 'no run'}), so no single PR broke it.`,
    );
    return 0;
  }
  if (Number(attempt) < 2) {
    await must(run, ['gh', 'run', 'rerun', runId, '--failed', '--repo', repo]);
    log(
      `CI failed on ${branch} at ${sha.slice(0, 7)}. Reran the failed jobs once, in case a test is flaky.`,
    );
    return 0;
  }
  const commit = JSON.parse(
    await must(run, [
      'gh',
      'api',
      `repos/${repo}/commits/${sha}`,
      '--jq',
      '{message: .commit.message, parents: [.parents[].sha]}',
    ]),
  ) as { message: string; parents: Array<string> };
  // CI also runs on the release commit, whose parent is the merge.
  const merge =
    releaseCommit.test(commit.message) && commit.parents.length === 1 ? commit.parents[0] : sha;
  const pr = await must(run, [
    'gh',
    'api',
    `repos/${repo}/commits/${merge}/pulls`,
    '--jq',
    `[.[] | select(.merged_at != null and .merge_commit_sha == "${merge}")][0].number // empty`,
  ]);
  if (!pr) {
    log(`${merge.slice(0, 7)} is not the merge of a pull request. No revert.`);
    return 0;
  }
  if (!(await autoMerged(run, repo, pr))) {
    log(
      `A person merged #${pr}, so it gets no automatic revert. Fix forward or add the revert label.`,
    );
    return 0;
  }
  // The label may be missing before the Labels workflow has run. Creating it
  // needs the Issues permission, which this job does not grant. So a failure is
  // not fatal: the add below fails if the label still does not exist. The color
  // and description match apps/cli/src/labels/compute.ts.
  await run([
    'gh',
    'label',
    'create',
    'revert',
    '--force',
    '--repo',
    repo,
    '--color',
    'e99695',
    '--description',
    'Revert this merged PR: the Revert workflow opens the revert PR',
  ]);
  await must(run, ['gh', 'pr', 'edit', pr, '--repo', repo, '--add-label', 'revert']);
  await must(run, [
    'gh',
    'workflow',
    'run',
    'revert.yml',
    '--repo',
    repo,
    '--ref',
    branch,
    '-f',
    `pr=${pr}`,
  ]);
  await must(run, [
    'gh',
    'pr',
    'comment',
    pr,
    '--repo',
    repo,
    '--body',
    `CI failed on \`${branch}\` at ${sha.slice(0, 7)} twice after auto-merge merged this PR, and it was green before. The Revert workflow opens the revert PR. Run: https://github.com/${repo}/actions/runs/${runId}`,
  ]);
  log(`Auto-merge merged #${pr}, and ${branch} went red after it. Started its revert.`);
  return 0;
}

const spawn: Run = async (command) => {
  const proc = Bun.spawn(command, { cwd: root, stdout: 'pipe', stderr: 'pipe' });
  const [out, err, code] = await Promise.all([
    new Response(proc.stdout).text(),
    new Response(proc.stderr).text(),
    proc.exited,
  ]);
  return { ok: code === 0, out, err };
};

if (import.meta.main) {
  try {
    process.exit(await runAutoRevert(process.argv.slice(2), spawn));
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exit(1);
  }
}
