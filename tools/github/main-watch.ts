import { runAutoRevert } from '@tools/github/auto-revert';
import { must } from '@tools/github/github';
import type { Clock } from '@tools/github/github';
import type { Run } from '@tools/github/stack';

/**
 * The steps of `pr merge` that run after a session asks to merge: dispatch the
 * Auto-merge workflow and wait for its decision and the merge, then watch CI
 * on the default branch at the merge commit. The workflow judges with the
 * default branch's rules and merges with the release bot's token, so the
 * release and CI run after the merge. See
 * .agents/skills/deliver/references/pull-requests.md#merge.
 */

type Timing = { clock: Clock; timeout: number; interval: number };

type WorkflowRun = {
  databaseId: number;
  displayTitle: string;
  status: string;
  conclusion: string;
  createdAt: string;
  url: string;
};

type CiRun = {
  databaseId: number;
  headSha: string;
  status: string;
  conclusion: string;
  attempt: number;
  url: string;
};

/** The first line of each verdict that tools/github/auto-merge.ts prints. */
const verdictStart = /^(Would (not )?auto-merge|Not judged:|The head moved)/u;

/**
 * The verdict that the decide job printed, from the run's log. `gh run view
 * --log` names each step `UNKNOWN STEP` for a recent run, so the verdict is
 * found by its first line, and it ends at the next line that the runner wrote.
 */
export function verdictOf(log: string) {
  const lines = log
    .split('\n')
    .map((line) => line.split('\t'))
    .filter((fields) => fields.length >= 3 && fields[0] === 'decide')
    .map((fields) =>
      fields
        .slice(2)
        .join('\t')
        .replace(/^\S+Z /u, ''),
    );
  const start = lines.findIndex((line) => verdictStart.test(line));
  if (start === -1) {
    return '';
  }
  const end = lines.findIndex(
    (line, index) => index > start && /^(##\[|Post job cleanup\.|\[command\])/u.test(line),
  );
  return lines
    .slice(start, end === -1 ? undefined : end)
    .join('\n')
    .trim();
}

/** The recent dispatched Auto-merge runs for PR `number`. */
async function dispatched(run: Run, number: string) {
  const out = await must(run, [
    'gh',
    'run',
    'list',
    '--workflow',
    'auto-merge.yml',
    '--event',
    'workflow_dispatch',
    '--limit',
    '20',
    '--json',
    'databaseId,displayTitle,status,conclusion,createdAt,url',
  ]);
  return (JSON.parse(out || '[]') as Array<WorkflowRun>).filter(
    (item) => item.displayTitle === `Auto-merge #${number}`,
  );
}

/**
 * The workflow run that `gh workflow run` started: the first run for PR
 * `number` that is not in `before`. Run ids do not depend on any clock.
 */
async function findRun(run: Run, number: string, before: Set<number>, timing: Timing) {
  const end = timing.clock.now() + timing.timeout;
  for (;;) {
    const runs = await dispatched(run, number);
    const found = runs.find((item) => !before.has(item.databaseId));
    if (found?.status === 'completed') {
      return found;
    }
    if (timing.clock.now() >= end) {
      throw new Error(
        found
          ? `The Auto-merge run for #${number} is still ${found.status} after the timeout: ${found.url}`
          : `No Auto-merge run started for #${number} before the timeout.`,
      );
    }
    await timing.clock.sleep(timing.interval);
  }
}

type Merged = { merged: true; sha: string } | { merged: false; message: string };

/**
 * Dispatches the Auto-merge workflow for PR `number` and waits until GitHub
 * merges it. When the judge holds the PR, it returns the verdict instead.
 */
export async function autoMerge(
  run: Run,
  number: string,
  trunk: string,
  timing: Timing,
): Promise<Merged> {
  const earlier = await dispatched(run, number);
  const before = new Set(earlier.map((item) => item.databaseId));
  await must(run, [
    'gh',
    'workflow',
    'run',
    'auto-merge.yml',
    '--ref',
    trunk,
    '-f',
    `pr=${number}`,
  ]);
  console.log(`Dispatched Auto-merge for #${number}. Waiting for its decision.`);
  const decided = await findRun(run, number, before, timing);
  if (decided.conclusion !== 'success') {
    throw new Error(
      `The Auto-merge run for #${number} ended ${decided.conclusion}: ${decided.url}. Read it with: gh run view --log-failed ${decided.databaseId}`,
    );
  }
  const end = timing.clock.now() + timing.timeout;
  for (;;) {
    const pr = JSON.parse(
      await must(run, ['gh', 'pr', 'view', number, '--json', 'state,autoMergeRequest,mergeCommit']),
    ) as { state: string; autoMergeRequest: unknown; mergeCommit: { oid: string } | null };
    if (pr.state === 'MERGED' && pr.mergeCommit) {
      return { merged: true, sha: pr.mergeCommit.oid };
    }
    if (pr.state !== 'OPEN' || !pr.autoMergeRequest) {
      const log = await run(['gh', 'run', 'view', String(decided.databaseId), '--log']);
      const verdict = (log.ok && verdictOf(log.out)) || `See the run: ${decided.url}`;
      return { merged: false, message: verdict };
    }
    if (timing.clock.now() >= end) {
      throw new Error(
        `GitHub queued the merge of #${number} but did not merge it before the timeout. Run \`bun run pr status ${number}\`.`,
      );
    }
    await timing.clock.sleep(timing.interval);
  }
}

/**
 * Waits for CI's push run on the default branch at `sha`, the merge commit.
 * Green ends the watch. Red goes through the auto-revert rules, the same as the
 * Auto-revert workflow: a first failure reruns the failed jobs once, and a
 * second one starts the revert of an auto-merged PR. Both are safe to run
 * twice, so the session and the workflow can both act. Returns 0 when main is
 * green at the merge, and 1 when it is red or the watch timed out.
 */
export async function watchMain(
  run: Run,
  options: Timing & { repo: string; trunk: string; sha: string; watch: Array<string> },
) {
  const { clock, repo, trunk, sha } = options;
  const end = clock.now() + options.timeout;
  let handled = 0;
  // The rerun of a failed attempt, which the auto-revert rules report.
  const rerun = { started: false };
  const reran = () => {
    rerun.started = true;
  };
  for (;;) {
    const list = await run([
      'gh',
      'run',
      'list',
      '--workflow',
      'ci.yml',
      '--branch',
      trunk,
      '--event',
      'push',
      '--limit',
      '20',
      '--json',
      'databaseId,headSha,status,conclusion,attempt,url',
    ]);
    if (!list.ok) {
      // Only a missing workflow means no CI to watch. Any other error fails the watch.
      if (/HTTP 404|workflow .* not found/iu.test(list.err)) {
        console.log('This repository has no ci.yml, so no CI on main to watch.');
        return 0;
      }
      console.log(`Could not read the CI runs on ${trunk}: ${list.err.trim()}`);
      return 1;
    }
    const ci = (JSON.parse(list.out || '[]') as Array<CiRun>).find((item) => item.headSha === sha);
    // gh names the attempt of each run. An older gh that does not counts it as the first.
    const attempt = ci?.attempt ?? 1;
    if (ci?.status === 'completed' && attempt > handled) {
      if (ci.conclusion === 'success') {
        console.log(`CI is green on ${trunk} at ${sha.slice(0, 7)}: ${ci.url}`);
        return 0;
      }
      handled = attempt;
      rerun.started = false;
      console.log(`CI ended ${ci.conclusion} on ${trunk} at ${sha.slice(0, 7)}: ${ci.url}`);
      await runAutoRevert(
        [
          '--sha',
          sha,
          '--branch',
          trunk,
          '--run-id',
          String(ci.databaseId),
          '--attempt',
          String(attempt),
        ],
        run,
        {
          env: { GITHUB_REPOSITORY: repo },
          watch: options.watch,
          reran,
        },
      );
      // Without a rerun, no later attempt comes: main was red before, or only other checks failed.
      if (!rerun.started) {
        return 1;
      }
    }
    if (clock.now() >= end) {
      console.log(
        ci
          ? `CI on ${trunk} at ${sha.slice(0, 7)} is still ${ci.status} after the timeout: ${ci.url}`
          : `No CI run started on ${trunk} at ${sha.slice(0, 7)} before the timeout.`,
      );
      return 1;
    }
    await clock.sleep(options.interval);
  }
}
