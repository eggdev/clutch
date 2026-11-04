import { parseArgs } from 'node:util';

import { plan } from '@tools/github/babysit';
import { readPr } from '@tools/github/babysit-read';
import { retrying } from '@tools/github/command';
import { must } from '@tools/github/github';
import type { Run } from '@tools/github/stack';
import { ownerLogin, prStatus } from '@tools/github/status';
import type { PrStatus } from '@tools/github/status';

/**
 * The owner's review request comes last. While a check fails or runs, agent
 * review has a blocking finding, or the branch conflicts, the babysitter
 * withdraws the request, so the owner is not asked to approve a head that
 * will change. When only the owner's approval is left, it asks. See
 * .agents/skills/babysit-pr/SKILL.md#ask-the-owner-last.
 */

/** `ask` when only the owner is left, `withdraw` while work is left, else `keep`. */
export function ownerStep(
  status: Pick<PrStatus, 'counts' | 'agentReview' | 'mergeable' | 'mergeState' | 'ready'>,
  approved: boolean,
  requested: boolean,
  /** A thread or comment still needs a round, or the last round is stuck. */
  workLeft = false,
): 'ask' | 'withdraw' | 'keep' {
  if (approved || status.ready) {
    return 'keep';
  }
  const clean =
    status.counts.fail === 0 &&
    status.counts.pending === 0 &&
    status.agentReview.blocking === 0 &&
    status.mergeable === 'MERGEABLE' &&
    !workLeft;
  if (clean && status.mergeState === 'BLOCKED') {
    return requested ? 'keep' : 'ask';
  }
  return !clean && requested ? 'withdraw' : 'keep';
}

export async function askOwnerLast(run: Run, repo: string, owner: string, number: number) {
  const [status, state] = await Promise.all([
    prStatus(run, String(number)),
    readPr(run, repo, number, owner),
  ]);
  const logins = await must(run, [
    'gh',
    'api',
    `repos/${repo}/pulls/${number}/requested_reviewers`,
    '--jq',
    '.users[].login',
  ]);
  const requested = logins.split('\n').includes(owner);
  const next = plan(state, new Date().toISOString());
  const workLeft =
    next.threads.length > 0 ||
    next.comments.length > 0 ||
    state.log.rounds.at(-1)?.outcome === 'stuck';
  const step = ownerStep(status, state.approved, requested, workLeft);
  if (step === 'ask') {
    await must(run, ['gh', 'pr', 'edit', String(number), '--repo', repo, '--add-reviewer', owner]);
  } else if (step === 'withdraw') {
    await must(run, [
      'gh',
      'api',
      '--method',
      'DELETE',
      `repos/${repo}/pulls/${number}/requested_reviewers`,
      '-f',
      `reviewers[]=${owner}`,
    ]);
  }
  return step;
}

if (import.meta.main) {
  const { values } = parseArgs({
    args: process.argv.slice(2),
    options: { repo: { type: 'string' }, owner: { type: 'string' }, pr: { type: 'string' } },
  });
  try {
    const step = await askOwnerLast(
      retrying,
      values.repo ?? '',
      values.owner ?? (await ownerLogin()) ?? '',
      Number(values.pr),
    );
    console.log(`#${values.pr}: ${step} the owner's review request.`);
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exit(1);
  }
}
