import { readFile, writeFile } from 'node:fs/promises';
import { parseArgs } from 'node:util';

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
import { addRound, logHeading, renderDisposition, renderLog } from '@tools/github/babysit-log';
import type { Item, Round } from '@tools/github/babysit-log';
import { readPr } from '@tools/github/babysit-read';
import { retrying } from '@tools/github/command';
import { must } from '@tools/github/github';
import type { Run } from '@tools/github/stack';
import { ownerLogin } from '@tools/github/status';

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
  const left = items.filter(
    (i) => (i.decision === 'owner' && !i.resolved) || (fixes.has(i.decision) && !pushed),
  );
  return {
    outcome: left.some((i) => i.decision === 'owner') ? 'waiting-owner' : 'done',
    note: left.length > 0 ? `${left.length} item(s) left open.` : '',
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
  },
) {
  const context: Context = {
    run,
    repo: input.repo,
    plan: input.plan,
    answers: afterApproval(input.answers, input.plan.approved),
    pushed: input.pushed,
  };
  const items = [
    ...(await answerThreads(context)),
    ...(await closeApproved(context)),
    ...(await answerComments(context)),
    ...(await answerChecks(context)),
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
    input.plan.comments.map((c) => c.id),
  );
  return round;
}

if (import.meta.main) {
  const { values } = parseArgs({
    args: process.argv.slice(2),
    options: {
      repo: { type: 'string' },
      owner: { type: 'string' },
      plan: { type: 'string' },
      answers: { type: 'string' },
      pushed: { type: 'string' },
      sync: { type: 'string' },
      cost: { type: 'string' },
      models: { type: 'string' },
      event: { type: 'string' },
      run: { type: 'string' },
      out: { type: 'string' },
      stuck: { type: 'string' },
    },
  });
  try {
    const repo = values.repo ?? process.env.GITHUB_REPOSITORY ?? '';
    const owner = values.owner ?? (await ownerLogin()) ?? '';
    const plan = JSON.parse(await readFile(values.plan ?? '', 'utf-8')) as Plan;
    const now = new Date().toISOString();
    const cost = {
      usd: Number(values.cost ?? 0) || 0,
      models: (values.models ?? '').split(',').filter(Boolean),
    };
    const common = {
      at: now,
      run: values.run ?? '',
      event: values.event ?? '',
      head: plan.head,
      triggers: plan.triggers,
      pushed: null,
      cost,
    };
    let round: Round;
    if (values.stuck) {
      // The caps stopped this round before any model ran.
      round = { ...common, sync: 'none', items: [], outcome: 'stuck', note: values.stuck };
      await writeLog(retrying, repo, owner, plan.number, round, []);
    } else {
      const answers = values.answers
        ? ((JSON.parse(await readFile(values.answers, 'utf-8')) as { items?: Array<Answer> })
            .items ?? [])
        : [];
      round = await apply(retrying, {
        repo,
        owner,
        plan,
        answers,
        pushed: values.pushed || null,
        sync: (values.sync ?? 'none') as Round['sync'],
        cost,
        event: values.event ?? '',
        runUrl: values.run ?? '',
        now,
      });
    }
    if (values.out) {
      await writeFile(
        values.out,
        JSON.stringify({ repo, pr: plan.number, heading: logHeading, round }, null, 1),
      );
    }
    console.log(`#${plan.number}: ${round.outcome}. ${round.note}`);
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exit(1);
  }
}
