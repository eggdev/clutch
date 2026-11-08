import { plan } from '@tools/github/babysit';
import { blockingOnlyFix, unanswered } from '@tools/github/babysit-answer';
import type { Item } from '@tools/github/babysit-log';
import { readPr } from '@tools/github/babysit-read';
import type { Run } from '@tools/github/stack';
import { prStatus } from '@tools/github/status';
import type { PrStatus } from '@tools/github/status';

/**
 * The owner comes last. While a check fails or runs, agent review has a
 * blocking finding, or the branch conflicts, a head may still change, so the
 * session does not ask. When only the owner's approval is left, it asks in its
 * own thread. No step requests a review on the PR. See
 * .agents/skills/deliver/SKILL.md#ask-the-owner.
 */

/** Whether the owner's approval is all that is left. */
export function onlyOwnerLeft(
  status: Pick<PrStatus, 'counts' | 'agentReview' | 'mergeable' | 'mergeState' | 'ready'>,
  approved: boolean,
  /** A thread or comment still needs a round, or the last round is stuck. */
  workLeft = false,
  /** The last round left a thread or comment for the owner. */
  waitingOwner = false,
) {
  const held = !status.ready && status.mergeState === 'BLOCKED';
  return (
    !approved &&
    (held || waitingOwner) &&
    status.counts.fail === 0 &&
    status.counts.pending === 0 &&
    status.agentReview.blocking === 0 &&
    status.mergeable === 'MERGEABLE' &&
    !workLeft
  );
}

/**
 * What only the owner can settle while work is still open: a failed check
 * that the round left for them, or a blocking finding that no one could fix.
 * These do not wait for the checks to pass, since nothing else can clear them.
 */
export function decisionsNow(items: ReadonlyArray<Item>) {
  return items.filter(
    (item) =>
      item.decision === 'owner' &&
      item.reason !== unanswered &&
      (item.kind === 'check' || item.reason.startsWith(blockingOnlyFix)),
  );
}

/** Reads PR `number`, and says whether only the owner is left. */
export async function ownerLeft(run: Run, repo: string, owner: string, number: number) {
  const [status, state] = await Promise.all([
    prStatus(run, String(number)),
    readPr(run, repo, number, owner),
  ]);
  const next = plan(state, new Date().toISOString());
  const workLeft =
    next.threads.length > 0 ||
    next.comments.length > 0 ||
    state.log.rounds.at(-1)?.outcome === 'stuck';
  const waitingOwner = state.log.rounds.at(-1)?.outcome === 'waiting-owner';
  return onlyOwnerLeft(status, state.approved, workLeft, waitingOwner);
}

/** How a round tells the session to reach the owner. */
const askInThread =
  "Ask in this session's thread with the question tool, in the fixed form of .agents/skills/deliver/SKILL.md#ask-the-owner";

/** What the session must ask the owner, when anything. */
export function ownerAsk(input: {
  repo: string;
  number: string;
  stuck: boolean;
  left: boolean;
  now: ReadonlyArray<Pick<Item, 'ref'>>;
}) {
  if (input.stuck) {
    return `${askInThread}.`;
  }
  if (input.left) {
    return `Only the owner is left. ${askInThread}, with this approve link: https://github.com/${input.repo}/pull/${input.number}/files`;
  }
  if (input.now.length > 0) {
    return `${input.now.map((item) => item.ref).join(', ')} need the owner now. ${askInThread}.`;
  }
  return null;
}
