import { replyMarker, stuckLabel } from '@tools/github/babysit';
import type { Plan } from '@tools/github/babysit';
import {
  afterApproval,
  answerChecks,
  answerComments,
  answerThreads,
  closeApproved,
  fixes,
} from '@tools/github/babysit-answer';
import type { Answer, Context } from '@tools/github/babysit-answer';
import { addRound, renderDisposition, renderLog } from '@tools/github/babysit-log';
import type { Item, Round } from '@tools/github/babysit-log';
import { readPr } from '@tools/github/babysit-read';
import { must } from '@tools/github/github';
import type { Run } from '@tools/github/stack';

/**
 * The deterministic half of a round. The agent decides and edits files; this
 * replies, resolves, reruns and writes the log, so the agent never holds a
 * token that can push or resolve. See .agents/skills/babysit-pr/SKILL.md.
 */

/** The outcome of a round from what it left open. */
export function outcomeOf(
  items: Array<Item>,
  pushed: string | null,
  sync: Round['sync'],
): Pick<Round, 'outcome' | 'note'> {
  if (sync === 'conflict-stuck') {
    return {
      outcome: 'stuck',
      note: 'The merge with the base needs a judgment call. A person resolves it.',
    };
  }
  // A fix that did not pass validate is left open, and a person looks at it.
  const unfixed = items.filter((i) => fixes.has(i.decision) && !pushed);
  if (unfixed.length > 0) {
    return {
      outcome: 'stuck',
      note: `${unfixed.length} fix(es) did not pass validate, so nothing was pushed.`,
    };
  }
  const owner = items.filter((i) => i.decision === 'owner' && !i.resolved);
  return {
    outcome: owner.length > 0 ? 'waiting-owner' : 'done',
    note: owner.length > 0 ? `${owner.length} item(s) wait for the owner.` : '',
  };
}

/** Edits the babysitter's disposition comment, or posts it. A person's own disposition is left alone. */
async function writeDisposition(
  run: Run,
  repo: string,
  number: number,
  comments: Array<{ id: number; body: string }>,
  body: string | null,
) {
  if (!body) {
    return;
  }
  const mine = comments.findLast(
    (c) => c.body.startsWith('## Review disposition') && c.body.includes(replyMarker),
  );
  const text = `${body}\n${replyMarker}`;
  await must(
    run,
    mine
      ? [
          'gh',
          'api',
          '--method',
          'PATCH',
          `repos/${repo}/issues/comments/${mine.id}`,
          '-f',
          `body=${text}`,
        ]
      : ['gh', 'pr', 'comment', String(number), '--repo', repo, '--body', text],
  );
}

/** Edits the PR's log comment, or posts it, with one more round. Marks or clears the stuck label. */
export async function writeLog(
  run: Run,
  repo: string,
  owner: string,
  number: number,
  round: Round,
  answered: Array<number>,
) {
  const state = await readPr(run, repo, number, owner);
  const log = addRound(state.log, round, answered);
  const body = renderLog(log);
  await must(
    run,
    state.logId
      ? [
          'gh',
          'api',
          '--method',
          'PATCH',
          `repos/${repo}/issues/comments/${state.logId}`,
          '-f',
          `body=${body}`,
        ]
      : ['gh', 'pr', 'comment', String(number), '--repo', repo, '--body', body],
  );
  await writeDisposition(run, repo, number, state.comments, renderDisposition(log));
  const stuck = round.outcome === 'stuck';
  if (stuck !== state.labels.includes(stuckLabel)) {
    await must(run, [
      'gh',
      'pr',
      'edit',
      String(number),
      '--repo',
      repo,
      stuck ? '--add-label' : '--remove-label',
      stuckLabel,
    ]);
  }
}

/** The comments that the owner's answer in the thread closes. They have no thread to resolve. */
function closedComments(plan: Plan, ownerSaid?: string): Array<Item> {
  if (!ownerSaid) {
    return [];
  }
  return plan.waiting
    .filter((item) => item.kind === 'comment')
    .map((item) => ({
      ...item,
      reason: 'the owner answered in the thread',
      action: 'resolved by the answer',
      resolved: true,
    }));
}

/** Applies one round's answers and returns the round for the log. */
export async function apply(
  run: Run,
  input: {
    repo: string;
    owner: string;
    plan: Plan;
    answers: Array<Answer>;
    pushed: string | null;
    sync: Round['sync'];
    cost: Round['cost'];
    event: string;
    runUrl: string;
    now: string;
    ownerSaid?: string;
  },
) {
  const context: Context = {
    run,
    repo: input.repo,
    plan: input.plan,
    answers: afterApproval(input.answers, input.plan.approved),
    pushed: input.pushed,
    ownerSaid: input.ownerSaid,
  };
  const items = [
    ...(await answerThreads(context)),
    ...(await closeApproved(context)),
    ...(await answerComments(context)),
    ...(await answerChecks(context)),
    ...closedComments(input.plan, input.ownerSaid),
  ];
  const round: Round = {
    at: input.now,
    run: input.runUrl,
    event: input.event,
    triggers: input.plan.triggers,
    head: input.plan.head,
    sync: input.sync,
    items,
    pushed: input.pushed,
    cost: input.cost,
    ...outcomeOf(items, input.pushed, input.sync),
  };
  // Each comment gets one answer. An owner item waits for a new comment, not the next round.
  await writeLog(
    run,
    input.repo,
    input.owner,
    input.plan.number,
    round,
    items.filter((item) => item.kind === 'comment').map((item) => Number(item.ref)),
  );
  return round;
}
