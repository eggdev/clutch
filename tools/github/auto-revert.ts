import path from 'node:path';
import { parseArgs } from 'node:util';

import { isRed, latestChecks, requiredChecks } from '@tools/github/main-checks';
import type { CheckRun } from '@tools/github/main-checks';
import type { Run } from '@tools/github/stack';

/**
 * When CI fails on the default branch right after a green run, finds the pull
 * request that broke it. Main is red when a required check is red, and green
 * when every required check that ran passed, the same as auto-merge and the
 * red-main metric judge it. `autoRevert.watch` in clutch.yaml adds checks that
 * count here only, such as a deploy job. A failure of only other checks does
 * nothing. When auto-merge merged that PR, this labels it `revert` and starts
 * the Revert workflow, which opens the revert PR. A first failure only reruns
 * the failed jobs, so a flaky test does not revert a PR. A PR that a person
 * merged gets no automatic revert: the person who merged it owns the fix.
 * `pr merge` runs the same rules from the session that merged, while the
 * Auto-revert workflow stays as the net for a session that stopped. Both may
 * act on the same failure, so a rerun that already started and a revert that
 * already started are not errors. See
 * docs/contributing/operations/rollback.md#auto-revert.
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

/**
 * Whether `pr` is an agent's PR: its branch is `clutch/cl-NNN-<slug>`, which
 * only an agent's task makes. The release bot opens it, or the user's token
 * when the bot is not set up. Its session may have merged it with
 * `pr merge --owner`, on the owner's word, so it carries no enabled marker.
 */
async function agentPr(run: Run, repo: string, pr: string) {
  const out = await must(run, ['gh', 'api', `repos/${repo}/pulls/${pr}`, '--jq', '.head.ref']);
  return /^clutch\/cl-\d+/u.test(out.trim());
}

/** Whether the net may revert `pr`: auto-merge merged it, or it is an agent's PR. */
async function revertable(run: Run, repo: string, pr: string) {
  return (await autoMerged(run, repo, pr)) || agentPr(run, repo, pr);
}

type CiRun = { headSha: string; conclusion: string; status: string };

/**
 * The last finished push run of CI on the branch before the run for `sha`. A
 * cancelled or skipped run says nothing, so it is passed over. A run that
 * failed on a check that is not required still counts, so its own checks decide.
 */
export function previousRun(runs: Array<CiRun>, sha: string) {
  const index = runs.findIndex((ciRun) => ciRun.headSha === sha);
  const before = index === -1 ? [] : runs.slice(index + 1);
  return before.find(
    (ciRun) => ciRun.status === 'completed' && ['success', 'failure'].includes(ciRun.conclusion),
  );
}

/**
 * Whether every check in `names` that ran on a commit concluded success, and at
 * least one ran. A skipped check did not run, as GitHub counts a skipped
 * required check as passing, and a check that is missing never ran.
 */
export function isGreen(checks: Map<string, CheckRun>, names: Array<string>) {
  const ran = names
    .map((name) => checks.get(name))
    .filter((check): check is CheckRun => check !== undefined && check.conclusion !== 'skipped');
  return (
    ran.length > 0 &&
    ran.every((check) => check.status === 'completed' && check.conclusion === 'success')
  );
}

/**
 * The `autoRevert.watch` names of the clutch.yaml at `file`: checks that count
 * as required for auto-revert only. A repository without the file watches none.
 * The config loader in apps/cli validates the whole file. This reads only this
 * key, because tools may not import from apps.
 */
export async function readWatch(file: string): Promise<Array<string>> {
  const handle = Bun.file(file);
  if (!(await handle.exists())) {
    return [];
  }
  const { autoRevert } = (Bun.YAML.parse(await handle.text()) ?? {}) as { autoRevert?: unknown };
  if (autoRevert === undefined) {
    return [];
  }
  const invalid =
    'clutch.yaml: autoRevert must be a map with watch, a list of check or job names such as production.';
  if (typeof autoRevert !== 'object' || autoRevert === null || Array.isArray(autoRevert)) {
    throw new Error(invalid);
  }
  const { watch = [] } = autoRevert as { watch?: unknown };
  if (!Array.isArray(watch) || watch.some((name) => typeof name !== 'string' || !name.trim())) {
    throw new Error(invalid);
  }
  return watch.map((name: string) => name.trim());
}

/**
 * Reruns the failed jobs of a run once, in case a test is flaky. The other
 * actor may have rerun it first, so a refused rerun only logs: the next
 * attempt decides either way.
 */
async function rerunOnce(
  run: Run,
  options: {
    repo: string;
    runId: string;
    at: string;
    log: (text: string) => void;
    reran?: () => void;
  },
) {
  const { repo, runId, at, log, reran } = options;
  const rerun = await run(['gh', 'run', 'rerun', runId, '--failed', '--repo', repo]);
  const why = (rerun.err || rerun.out).trim();
  // The session and the Auto-revert workflow can both rerun. Only that race is not an error.
  if (!rerun.ok && !/already running|is not completed|in progress/iu.test(why)) {
    throw new Error(`gh run rerun ${runId} failed: ${why}`);
  }
  log(
    rerun.ok
      ? `CI failed on ${at}. Reran the failed jobs once, in case a test is flaky.`
      : `CI failed on ${at}. The rerun did not start, because it already runs: ${why}`,
  );
  reran?.();
}

/** Whether `pr` already carries the `revert` label, so its revert already started. */
async function revertStarted(run: Run, repo: string, pr: string) {
  const labels = await must(run, [
    'gh',
    'api',
    `repos/${repo}/issues/${pr}/labels`,
    '--jq',
    '.[].name',
  ]);
  return labels.split('\n').includes('revert');
}

/**
 * Labels `pr` `revert` and starts the Revert workflow, which opens the revert
 * PR. A revert that already started is left alone.
 */
async function startRevert(
  run: Run,
  options: {
    repo: string;
    pr: string;
    branch: string;
    sha: string;
    runId: string;
    log: (text: string) => void;
  },
) {
  const { repo, pr, branch, sha, runId, log } = options;
  if (await revertStarted(run, repo, pr)) {
    log(`The revert of #${pr} already started. Drive its revert PR, revert/${pr}, to the merge.`);
    return;
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
  // The REST issues endpoint adds a label to a PR. `gh pr edit` fails on
  // Projects (classic), which GitHub is retiring, so it does not add labels.
  await must(run, [
    'gh',
    'api',
    '--method',
    'POST',
    `repos/${repo}/issues/${pr}/labels`,
    '-f',
    'labels[]=revert',
  ]);
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
}

/** Runs the check. Returns the exit code. */
export async function runAutoRevert(
  args: Array<string>,
  run: Run,
  options: {
    log?: (text: string) => void;
    env?: Record<string, string | undefined>;
    watch?: Array<string>;
    /** Called when the failed jobs rerun, so a watcher waits for the next attempt. */
    reran?: () => void;
  } = {},
): Promise<number> {
  const { log = console.log, watch = [], reran } = options;
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
  const names = [...new Set([...(await requiredChecks(run, repo, branch)), ...watch])];
  const previous = previousRun(runs, sha);
  const greenBefore =
    previous !== undefined &&
    isGreen(await latestChecks(run, repo, branch, previous.headSha), names);
  if (!greenBefore) {
    const why = previous
      ? `its previous run ${previous.headSha.slice(0, 7)} did not pass every required check`
      : 'there is no earlier run';
    log(`${branch} was not green before ${sha.slice(0, 7)} (${why}), so no single PR broke it.`);
    return 0;
  }
  const failing = await latestChecks(run, repo, branch, sha);
  if (!names.some((name) => isRed(failing.get(name)))) {
    const others = [...failing]
      .filter(([name, check]) => !names.includes(name) && isRed(check))
      .map(([name]) => name);
    log(
      others.length > 0
        ? `Only checks that are not required failed (${others.join(', ')}), so no revert.`
        : `No required check failed on ${branch} at ${sha.slice(0, 7)}, so no revert.`,
    );
    return 0;
  }
  if (Number(attempt) < 2) {
    await rerunOnce(run, { repo, runId, at: `${branch} at ${sha.slice(0, 7)}`, log, reran });
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
  if (!(await revertable(run, repo, pr))) {
    log(
      `A person merged #${pr}, so it gets no automatic revert. Fix forward or add the revert label.`,
    );
    return 0;
  }
  await startRevert(run, { repo, pr, branch, sha, runId, log });
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
    const watch = await readWatch(path.join(root, 'clutch.yaml'));
    process.exit(await runAutoRevert(process.argv.slice(2), spawn, { watch }));
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exit(1);
  }
}
