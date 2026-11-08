import { isAgentPr as agentRule } from '@tools/github/auto-merge-rules';
import { roundsToday, unanswered } from '@tools/github/babysit-log';
import type { Item } from '@tools/github/babysit-log';
import { isBlocking } from '@tools/github/babysit-read';
import type { Comment, FailedCheck, PrState, Thread } from '@tools/github/babysit-read';

/**
 * The babysitter's view of one agent PR: what still needs a round, and
 * whether the caps allow one. The session that built the PR runs `bun run pr
 * babysit <number>` for each round. See .agents/skills/babysit-pr/SKILL.md.
 */

/** Each babysitter reply ends with this, so it never answers itself. */
export const replyMarker = '<!-- clutch-babysit -->';

/** The label that holds a PR out of the sweep until a person or a new head clears it. */
export const stuckLabel = 'babysit:stuck';
/** The label that turns the babysitter off for one PR. */
const offLabel = 'babysit:off';

/** At most this many rounds on one head for the same work. A third would repeat the second. */
export const roundsPerTrigger = 2;
/** At most this many rounds for one PR in a UTC day. */
export const roundsPerDay = 8;
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

type Trigger =
  | 'conflict'
  | 'behind'
  | 'red-check'
  | 'open-thread'
  | 'new-comment'
  | 'owner-approved';

/** Why a plan has no round when the PR needs no work. */
export const nothingToDo = 'nothing to do';

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
  /** Threads and comments that a round left for the owner, and no later round closed. */
  waiting: Array<Item>;
  /** The waiting threads that the owner's answer in the session's thread can close. */
  ownerThreads: Array<Thread>;
  /** Why no round runs, when none does. */
  skip: string | null;
  /** True when the caps stop a round that has work. The workflow marks the PR stuck. */
  stuck: boolean;
};

/** An agent PR, by the rule auto-merge uses, and never a fork. A Renovate or other bot branch is not one. */
export function isAgentPr(state: Pick<PrState, 'author' | 'authorIsBot' | 'headRef' | 'fork'>) {
  return (
    !state.fork &&
    agentRule({
      headRefName: state.headRef,
      author: { login: state.author, is_bot: state.authorIsBot },
    })
  );
}

const answeredByBabysitter = (body: string) => body.includes(replyMarker);

/**
 * What the log still leaves for the owner: the newest entry for each thread or
 * comment, when it waits for them and its thread is still open. A failed check
 * is not here: it asks when the round decides it, and clears when it passes.
 */
function waitingOwner(state: Pick<PrState, 'log' | 'threads'>) {
  const open = new Set(state.threads.map((t) => t.id));
  const newest = new Map(
    state.log.rounds.flatMap((round) => round.items).map((item) => [item.ref, item]),
  );
  return [...newest.values()].filter(
    (item) =>
      item.kind !== 'check' &&
      item.decision === 'owner' &&
      !item.resolved &&
      item.reason !== unanswered &&
      (item.kind !== 'thread' || open.has(item.ref)),
  );
}

/** The work on a PR now, and whether the caps let a round run. `now` is an ISO time. */
export function plan(state: PrState, now: string): Plan {
  const answered = new Set(state.log.answered);
  // A thread is open work until the babysitter has the last word in it.
  const threads = state.threads.filter((t) => !answeredByBabysitter(t.comments.at(-1)?.body ?? ''));
  // The owner's approval of the head answers each thread the babysitter left for the owner.
  // A blocking finding is never answered by the approval: only a fix closes it.
  const approvedThreads = state.approved
    ? state.threads.filter((t) => !threads.includes(t) && !isBlocking(t.comments[0]?.body))
    : [];
  const waiting = waitingOwner(state);
  const waitingRefs = new Set(waiting.map((item) => item.ref));
  const ownerThreads = state.threads.filter(
    (t) => waitingRefs.has(t.id) && !isBlocking(t.comments[0]?.body),
  );
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
    waiting,
    ownerThreads,
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
    return skip(nothingToDo);
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
