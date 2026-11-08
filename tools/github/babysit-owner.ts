import { plan } from '@tools/github/babysit';
import { blockingOnlyFix } from '@tools/github/babysit-answer';
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
) {
  return (
    !approved &&
    !status.ready &&
    status.counts.fail === 0 &&
    status.counts.pending === 0 &&
    status.agentReview.blocking === 0 &&
    status.mergeable === 'MERGEABLE' &&
    status.mergeState === 'BLOCKED' &&
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
  return onlyOwnerLeft(status, state.approved, workLeft);
}
