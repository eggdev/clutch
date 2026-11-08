import { replyMarker } from '@tools/github/babysit';
import type { Plan } from '@tools/github/babysit';
import type { Decision, Item } from '@tools/github/babysit-log';
import { unanswered } from '@tools/github/babysit-log';
import { isBlocking } from '@tools/github/babysit-read';
import { must } from '@tools/github/github';
import type { Run } from '@tools/github/stack';

/**
 * How a round answers each item: a reply in each thread, a resolve for each
 * answered one, one comment for the other comments, and a rerun for a flaky
 * check. See .agents/skills/babysit-pr/SKILL.md#decide.
 */

/** One decision, as the triage and fix steps return it. */
export type Answer = {
  kind: Item['kind'];
  ref: string;
  decision: Decision;
  reason: string;
  reply: string;
};

/** A fix answers a thread only when this round pushed it. */
export const fixes = new Set<Decision>(['must-fix', 'cheap-fix']);

/** Whether a thread with this decision is resolved after the reply. An owner item stays open, so the merge waits. */
export function resolves(decision: Decision, pushed: string | null) {
  if (fixes.has(decision)) {
    return pushed !== null;
  }
  return decision === 'no-change' || decision === 'after-approval';
}

/** What the reply says it did. */
export function actionOf(decision: Decision, pushed: string | null) {
  if (fixes.has(decision)) {
    return pushed ? `fixed in ${pushed.slice(0, 7)}` : 'not fixed: the fix did not pass validate';
  }
  const actions: Record<string, string> = {
    'no-change': 'no change',
    owner: 'left for the owner',
    flaky: 'reran the failed jobs',
    'after-approval': 'not fixed: after the owner approved this head',
  };
  return actions[decision] ?? decision;
}

/** After the owner's approval, only a blocking fix may push. Any other fix waits. */
export function afterApproval(answers: Array<Answer>, approved: boolean): Array<Answer> {
  return answers.map((a) =>
    approved && a.decision === 'cheap-fix' ? { ...a, decision: 'after-approval' as const } : a,
  );
}

const replyBody = (answer: Answer, action: string) =>
  `${answer.reply.trim()}\n\n_${answer.decision}: ${action}._\n\n${replyMarker}`;

export type Context = {
  run: Run;
  repo: string;
  plan: Plan;
  answers: Array<Answer>;
  pushed: string | null;

  /** What the owner answered in the session's thread, when this round records it. */
  ownerSaid?: string;
};

/** How the reason of a blocking finding that only a fix closes starts. */
export const blockingOnlyFix = 'a blocking finding closes only with a fix';

const firstLine = (body = '') => body.trimStart().split('\n')[0]?.slice(0, 200) ?? '';

/**
 * A `blocking` finding must not merge until it is fixed, so only a fix closes
 * its thread. A model that answers it any other way leaves it for the owner.
 */
export function blockingGuard(answer: Answer | undefined, finding: string): Answer | undefined {
  if (!answer || !isBlocking(finding) || fixes.has(answer.decision)) {
    return answer;
  }
  return {
    ...answer,
    decision: 'owner',
    reason: `${blockingOnlyFix}; the triage said ${answer.decision}: ${answer.reason}`,
  };
}

export async function answerThreads({ run, repo, plan, answers, pushed }: Context) {
  const items: Array<Item> = [];
  for (const thread of plan.threads) {
    const first = thread.comments[0];
    const answer = blockingGuard(
      answers.find((a) => a.kind === 'thread' && a.ref === thread.id),
      firstLine(first?.body),
    );
    const base = {
      kind: 'thread' as const,
      ref: thread.id,
      url: first?.url ?? '',
      author: first?.author ?? '',
      commentId: thread.commentId,
      path: thread.path,
      finding: firstLine(first?.body),
    };
    if (!answer) {
      items.push({
        ...base,
        decision: 'owner',
        reason: unanswered,
        action: actionOf('owner', pushed),
        resolved: false,
      });
      continue;
    }
    const action = actionOf(answer.decision, pushed);
    await must(run, [
      'gh',
      'api',
      '--method',
      'POST',
      `repos/${repo}/pulls/${plan.number}/comments/${thread.commentId}/replies`,
      '-f',
      `body=${replyBody(answer, action)}`,
    ]);
    const resolved = resolves(answer.decision, pushed);
    if (resolved) {
      await must(run, [
        'gh',
        'api',
        'graphql',
        '-f',
        `query=mutation { resolveReviewThread(input: {threadId: "${thread.id}"}) { thread { isResolved } } }`,
      ]);
    }
    items.push({ ...base, decision: answer.decision, reason: answer.reason, action, resolved });
  }
  return items;
}

/** Resolves each thread left for the owner, once the owner approves the head or answers. */
export async function closeApproved({ run, repo, plan, ownerSaid }: Context) {
  const items: Array<Item> = [];
  for (const thread of plan.approvedThreads ?? []) {
    const first = thread.comments[0];
    const said = ownerSaid
      ? `The owner answered in the session's thread: ${ownerSaid}`
      : `The owner approved \`${plan.head.slice(0, 7)}\`, which answers this.`;
    const body = `${said}\n\n${replyMarker}`;
    await must(run, [
      'gh',
      'api',
      '--method',
      'POST',
      `repos/${repo}/pulls/${plan.number}/comments/${thread.commentId}/replies`,
      '-f',
      `body=${body}`,
    ]);
    await must(run, [
      'gh',
      'api',
      'graphql',
      '-f',
      `query=mutation { resolveReviewThread(input: {threadId: "${thread.id}"}) { thread { isResolved } } }`,
    ]);
    items.push({
      kind: 'thread',
      ref: thread.id,
      url: first?.url ?? '',
      author: first?.author ?? '',
      commentId: thread.commentId,
      path: thread.path,
      finding: firstLine(first?.body),
      decision: 'owner',
      reason: ownerSaid ? 'the owner answered in the thread' : 'the owner approved the head',
      action: ownerSaid ? 'resolved by the answer' : 'resolved by the approval',
      resolved: true,
    });
  }
  return items;
}

/** Answers every other comment in one PR comment, with a line for each. */
export async function answerComments({ run, repo, plan, answers, pushed }: Context) {
  const items: Array<Item> = [];
  const lines: Array<string> = [];
  for (const comment of plan.comments) {
    const answer = answers.find((a) => a.kind === 'comment' && a.ref === String(comment.id));
    if (!answer) {
      continue;
    }
    const { decision } = answer;
    const action = actionOf(decision, pushed);
    const quote = comment.body.trim().split('\n')[0]?.slice(0, 140) ?? '';
    const reply = answer.reply.trim();
    lines.push(
      `- [${comment.author}](${comment.url}): > ${quote}\n  ${reply} _${decision}: ${action}._`,
    );
    items.push({
      kind: 'comment',
      ref: String(comment.id),
      url: comment.url,
      author: comment.author,
      decision,
      reason: answer.reason,
      action,
      resolved: false,
    });
  }
  if (lines.length > 0) {
    const body = `Babysitter replies, head \`${plan.head.slice(0, 7)}\`:\n\n${lines.join('\n')}\n\n${replyMarker}`;
    await must(run, ['gh', 'pr', 'comment', String(plan.number), '--repo', repo, '--body', body]);
  }
  return items;
}

/** Reruns the failed jobs of each check that the agent calls flaky. */
export async function answerChecks({ run, repo, plan, answers, pushed }: Context) {
  const items: Array<Item> = [];
  for (const check of plan.failed) {
    const answer = answers.find((a) => a.kind === 'check' && a.ref === check.name);
    const decision = answer?.decision ?? 'owner';
    const runId = /\/runs\/(\d+)/u.exec(check.url)?.[1];
    if (decision === 'flaky' && runId) {
      await must(run, ['gh', 'run', 'rerun', runId, '--failed', '--repo', repo]);
    }
    items.push({
      kind: 'check',
      ref: check.name,
      url: check.url,
      author: 'ci',
      decision,
      reason: answer?.reason ?? unanswered,
      action: actionOf(decision, pushed),
      resolved: false,
    });
  }
  return items;
}
