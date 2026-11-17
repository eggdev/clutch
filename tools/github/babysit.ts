import { isAgentPr as agentRule } from '@tools/github/auto-merge-rules';
import { roundsToday } from '@tools/github/babysit-log';
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
/** A check that still fails after this many pushed fixes needs the owner. See docs/contributing/delivery.md. */
export const fixesPerCheck = 3;
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

/** A failed check that the session could not fix: its failed run, its failing test when known, and its pushed fixes. */
export type OwnerCheck = {
  name: string;
  url: string;
  test?: string;
  fixes: Array<{ pushed: string; reason: string }>;
};

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
  /** Failed checks that still fail after their third pushed fix in a row. Only the owner clears them. */
  ownerNow: Array<OwnerCheck>;
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
 * Whether a person wrote this comment. `gh` often runs as the owner's own
 * account, so a comment from that account is the tool's own only when it
 * carries the tool's marker.
 */
function byPerson(comment: Comment, viewer?: string) {
  if (comment.author.endsWith('[bot]') || machine.some((m) => m.test(comment.body))) {
    return false;
  }
  return (Boolean(viewer) && comment.author !== viewer) || !answeredByBabysitter(comment.body);
}

/**
 * Each failed check with at least `fixesPerCheck` pushed fixes since its count
 * started. The count starts again after the latest round logged as stuck,
 * since the owner answered that ask, and after a person's comment. It also
 * starts again at a push where the check was green.
 */
function checksForOwner(state: PrState): Array<OwnerCheck> {
  const since =
    [
      state.log.rounds.findLast((r) => r.outcome === 'stuck')?.at ?? '',
      ...state.comments.filter((c) => byPerson(c, state.viewer)).map((c) => c.at),
    ]
      .toSorted()
      .at(-1) ?? '';
  return state.failed.flatMap((check) => {
    const fixes: OwnerCheck['fixes'] = [];
    let test: string | undefined;
    for (const round of state.log.rounds.toReversed()) {
      if (round.at <= since) {
        break;
      }
      const items = round.items.filter((i) => i.kind === 'check' && i.ref === check.name);
      test ??= items.find((i) => i.test)?.test;
      if (!round.pushed) {
        continue;
      }
      // The round does not list the check, so it was green at that head.
      if (items.length === 0) {
        break;
      }
      for (const item of items.filter((i) => i.action.startsWith('fixed in'))) {
        fixes.unshift({ pushed: round.pushed, reason: item.reason });
      }
    }
    return fixes.length >= fixesPerCheck
      ? [{ name: check.name, url: check.url, ...(test ? { test } : {}), fixes }]
      : [];
  });
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
    ownerNow: state.pending === 0 ? checksForOwner(state) : [],
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
    !state.comments.some((c) => c.at > stuckAt.at && byPerson(c, state.viewer))
  ) {
    return skip(`labelled ${stuckLabel}`);
  }
  // A check that three fixes did not clear stops the round: the owner decides the next step.
  if (base.ownerNow.length > 0) {
    const names = base.ownerNow.map((c) => c.name).join(', ');
    return skip(`${names} still failed after ${fixesPerCheck} fixes and needs the owner now`, true);
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
