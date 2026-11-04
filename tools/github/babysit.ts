import { parseArgs } from 'node:util';

import { roundsToday } from '@tools/github/babysit-log';
import { readPr } from '@tools/github/babysit-read';
import type { Comment, FailedCheck, PrState, Thread } from '@tools/github/babysit-read';
import { retrying } from '@tools/github/command';
import { must } from '@tools/github/github';
import type { Run } from '@tools/github/stack';

/**
 * The babysitter's view of one agent PR: what still needs a round, and
 * whether the caps allow one. The Babysit workflow runs `plan` before each
 * round, and `sweep` on each event to dispatch the PRs that need one. See
 * .agents/skills/babysit-pr/SKILL.md.
 */

/** Each babysitter reply ends with this, so it never answers itself. */
export const replyMarker = '<!-- clutch-babysit -->';

/** The label that holds a PR out of the sweep until a person or a new head clears it. */
export const stuckLabel = 'babysit:stuck';
/** The label that turns the babysitter off for one PR. */
export const offLabel = 'babysit:off';

/** At most this many rounds on one head for the same work. A third would repeat the second. */
export const roundsPerTrigger = 2;
/** At most this many rounds for one PR in a UTC day. */
export const roundsPerDay = 8;
/** At most this many PRs dispatched by one sweep. */
export const sweepCap = 10;
/** A branch this many commits behind its base gets a merge sync, even with no conflict. */
export const behindLimit = 20;

/** Comments that machines post and that a thread or a check already carries. */
const machine = [
  /^\s*## Agent review/u,
  /^\s*## Review disposition/u,
  /^\s*## Babysit log/u,
  /<!-- (automerge-|clutch-visual-review|ci-explain|security-agent|verdict:|grader:)/u,
  /^Opened by the release bot/u,
];

export type Trigger =
  | 'conflict'
  | 'behind'
  | 'red-check'
  | 'open-thread'
  | 'new-comment'
  | 'owner-approved';

export type Plan = {
  number: number;
  head: string;
  approved: boolean;
  triggers: Array<Trigger>;
  sync: 'none' | 'merge' | 'conflict';
  failed: Array<FailedCheck>;
  threads: Array<Thread>;
  comments: Array<Comment>;
  /** Threads left for the owner that the owner's approval of this head now answers. They need no model. */
  approvedThreads: Array<Thread>;
  /** Why no round runs, when none does. */
  skip: string | null;
  /** True when the caps stop a round that has work. The workflow marks the PR stuck. */
  stuck: boolean;
};

/** An agent PR: the release bot opened it, or an agent's `clutch/cl-` branch. Never a fork. */
export function isAgentPr(state: Pick<PrState, 'author' | 'headRef' | 'fork'>) {
  return (
    !state.fork &&
    (state.author.startsWith('app/') ||
      state.author.endsWith('[bot]') ||
      state.headRef.startsWith('clutch/cl-'))
  );
}

const answeredByBabysitter = (body: string) => body.includes(replyMarker);

/** The work on a PR now, and whether the caps let a round run. `now` is an ISO time. */
export function plan(state: PrState, now: string): Plan {
  const answered = new Set(state.log.answered);
  // A thread is open work until the babysitter has the last word in it.
  const threads = state.threads.filter((t) => !answeredByBabysitter(t.comments.at(-1)?.body ?? ''));
  // The owner's approval of the head answers each thread the babysitter left for the owner.
  const approvedThreads = state.approved ? state.threads.filter((t) => !threads.includes(t)) : [];
  const comments = state.comments.filter(
    (c) =>
      !answered.has(c.id) && !answeredByBabysitter(c.body) && !machine.some((m) => m.test(c.body)),
  );
  let sync: Plan['sync'] = 'none';
  if (state.mergeable === 'CONFLICTING') {
    sync = 'conflict';
  } else if (state.behindBy >= behindLimit) {
    sync = 'merge';
  }
  const work: Array<[boolean, Trigger]> = [
    [sync === 'conflict', 'conflict'],
    [sync === 'merge', 'behind'],
    // A red check waits until no check is pending, so a rerun can finish first.
    [state.failed.length > 0 && state.pending === 0, 'red-check'],
    [threads.length > 0, 'open-thread'],
    [comments.length > 0, 'new-comment'],
    [approvedThreads.length > 0, 'owner-approved'],
  ];
  const triggers = work.filter(([on]) => on).map(([, trigger]) => trigger);
  const base = {
    number: state.number,
    head: state.head,
    approved: state.approved,
    triggers,
    sync,
    failed: state.failed,
    threads,
    comments,
    approvedThreads,
  } as const;
  const skip = (reason: string, stuck = false): Plan => ({ ...base, skip: reason, stuck });
  if (!state.open || state.draft) {
    return skip('closed or draft');
  }
  if (!isAgentPr(state)) {
    return skip('not an agent PR');
  }
  if (state.labels.includes(offLabel)) {
    return skip(`labelled ${offLabel}`);
  }
  if (triggers.length === 0) {
    return skip('nothing to do');
  }
  // A stuck PR waits for a new head or a person's new comment, not for the next event.
  const stuckAt = state.labels.includes(stuckLabel)
    ? state.log.rounds.findLast((r) => r.outcome === 'stuck')
    : undefined;
  if (
    stuckAt &&
    stuckAt.head === state.head &&
    !comments.some((c) => c.at > stuckAt.at && !c.author.endsWith('[bot]'))
  ) {
    return skip(`labelled ${stuckLabel}`);
  }
  const key = triggers.join(',');
  const same = state.log.rounds.filter(
    (r) => r.head === state.head && r.triggers.join(',') === key,
  ).length;
  if (same >= roundsPerTrigger) {
    return skip(
      `${same} rounds on ${state.head.slice(0, 7)} already met the same work: ${key}`,
      true,
    );
  }
  if (roundsToday(state.log, now) >= roundsPerDay) {
    return skip(`${roundsPerDay} rounds today already`, true);
  }
  return { ...base, skip: null, stuck: false };
}

/** The open agent PRs, one `gh` call. */
async function openPrs(run: Run, repo: string) {
  const out = await must(run, [
    'gh',
    'pr',
    'list',
    '--repo',
    repo,
    '--state',
    'open',
    '--limit',
    '50',
    '--json',
    'number,isDraft,isCrossRepository,headRefName,author',
  ]);
  return (
    JSON.parse(out) as Array<{
      number: number;
      isDraft: boolean;
      isCrossRepository: boolean;
      headRefName: string;
      author: { login: string; is_bot: boolean };
    }>
  )
    .filter((p) => !p.isDraft)
    .filter((p) =>
      isAgentPr({
        author: p.author.is_bot ? `app/${p.author.login.replace(/^app\//u, '')}` : p.author.login,
        headRef: p.headRefName,
        fork: p.isCrossRepository,
      }),
    )
    .map((p) => p.number);
}

/**
 * Dispatches a round for each PR that needs one, up to `sweepCap`. An event
 * that names a PR plans only that PR. A push to main or the schedule plans
 * every open agent PR.
 */
export async function sweep(
  run: Run,
  repo: string,
  owner: string,
  only: number | null,
  now: string,
  log = console.log,
) {
  const numbers = only ? [only] : await openPrs(run, repo);
  const dispatched: Array<number> = [];
  for (const number of numbers) {
    if (dispatched.length >= sweepCap) {
      break;
    }
    const state = await readPr(run, repo, number, owner);
    const next = plan(state, now);
    // A round that the caps stop still runs once, to log it and mark the PR stuck.
    if (next.skip && !next.stuck) {
      log(`#${number}: ${next.skip}.`);
      continue;
    }
    await must(run, ['gh', 'workflow', 'run', 'babysit.yml', '--repo', repo, '-f', `pr=${number}`]);
    dispatched.push(number);
    log(`#${number}: dispatched for ${next.stuck ? 'the stuck log' : next.triggers.join(', ')}.`);
  }
  return dispatched;
}

if (import.meta.main) {
  const { values, positionals } = parseArgs({
    args: process.argv.slice(2),
    allowPositionals: true,
    options: { repo: { type: 'string' }, pr: { type: 'string' }, owner: { type: 'string' } },
  });
  try {
    const repo = values.repo ?? process.env.GITHUB_REPOSITORY ?? '';
    const owner = values.owner ?? process.env.CLUTCH_OWNER ?? '';
    const now = new Date().toISOString();
    const number = values.pr ? Number(values.pr) : null;
    if (positionals[0] === 'sweep') {
      await sweep(retrying, repo, owner, number, now);
    } else if (positionals[0] === 'plan' && number) {
      console.log(JSON.stringify(plan(await readPr(retrying, repo, number, owner), now), null, 1));
    } else {
      console.error(
        'Usage: bun tools/github/babysit.ts sweep|plan --repo <owner/name> --owner <login> [--pr <n>]',
      );
      process.exit(2);
    }
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exit(1);
  }
}
