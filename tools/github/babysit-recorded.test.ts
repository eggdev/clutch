import { expect, test } from 'bun:test';

import { plan } from '@tools/github/babysit';
import type { Answer } from '@tools/github/babysit-answer';
import { apply } from '@tools/github/babysit-apply';
import { emptyGraph, now, state, thread } from '@tools/github/babysit-fake';
import type { Thread } from '@tools/github/babysit-read';
import { fake } from '@tools/github/fake-run';

/** The `recorded` decision: a round resolves an owner finding of agent review, and the weekly digest lists it. */

/** A thread whose first comment is `body` from `author`. */
const threadBy = (id: string, author: string, body: string, commentId: number): Thread => ({
  ...thread(id),
  commentId,
  comments: [{ id: commentId, author, body, at: now, url: `https://x/c${commentId}` }],
});

/** A `recorded` answer to one item. */
const recorded = (kind: Answer['kind'], ref: string): Answer => ({
  kind,
  ref,
  decision: 'recorded',
  reason: 'the task needs it',
  reply: 'Recorded for the weekly digest.',
});

test('apply resolves a recorded owner finding of agent review, and leaves any other recorded item to the owner', async () => {
  const { run, calls } = fake([
    ['gh api graphql -F', { out: emptyGraph }],
    ['gh api repos/acme/shop/compare', { out: '0' }],
  ]);
  const bot = 'github-actions[bot]';
  const next = plan(
    state({
      threads: [
        threadBy('T1', bot, '**owner** (A weaker check): the budget drops', 31),
        threadBy('T2', 'eggdev', 'owner: please look', 32),
        threadBy('T3', bot, 'blocking: docs did not move', 33),
      ],
      comments: [{ id: 5, author: 'eggdev', body: 'Lower budget?', at: now, url: 'https://x/c5' }],
    }),
    now,
  );
  const result = await apply(run, {
    repo: 'acme/shop',
    owner: 'eggdev',
    plan: next,
    answers: [
      recorded('thread', 'T1'),
      recorded('thread', 'T2'),
      recorded('thread', 'T3'),
      recorded('comment', '5'),
    ],
    pushed: null,
    sync: 'none',
    cost: { usd: 0.01, models: ['claude-haiku-5-5'] },
    event: 'issue_comment',
    runUrl: 'https://x/run/3',
    now,
  });
  const resolved = calls
    .filter((c) => c.includes('resolveReviewThread'))
    .map((c) => /threadId: "(\w+)"/u.exec(c)?.[1]);
  expect(resolved).toEqual(['T1']);
  const replies = calls.filter((c) => c.includes('/replies'));
  expect(replies).toHaveLength(3);
  expect(replies[0]).toContain('_recorded: recorded for the weekly digest._');
  const byRef = (ref: string) => result.items.find((i) => i.ref === ref);
  expect(byRef('T1')).toMatchObject({
    decision: 'recorded',
    action: 'recorded for the weekly digest',
    resolved: true,
  });
  expect(byRef('T2')).toMatchObject({
    decision: 'owner',
    reason:
      'only an owner finding of agent review is recorded; the triage said recorded: the task needs it',
    resolved: false,
  });
  expect(byRef('T3')?.reason).toStartWith('a blocking finding closes only with a fix');
  expect(byRef('5')?.decision).toBe('owner');
  expect(result.outcome).toBe('waiting-owner');
  const log = calls.find((c) => c.startsWith('gh pr comment 7') && c.includes('## Babysit log'));
  expect(log).toContain('| recorded | the task needs it | recorded for the weekly digest | yes |');
  const disposition = calls.find((c) => c.includes('## Review disposition'));
  expect(disposition).toContain(
    '- owner `tools/x.ts` (31): recorded for the weekly digest: the task needs it',
  );
  expect(disposition).toContain('- owner `tools/x.ts` (32): waits for the owner:');
});

test('a round whose only open items are recorded owner findings is done, not waiting for the owner', async () => {
  const { run } = fake([
    ['gh api graphql -F', { out: emptyGraph }],
    ['gh api repos/acme/shop/compare', { out: '0' }],
  ]);
  const next = plan(
    state({ threads: [threadBy('T1', 'github-actions[bot]', 'owner: a weaker check', 41)] }),
    now,
  );
  const result = await apply(run, {
    repo: 'acme/shop',
    owner: 'eggdev',
    plan: next,
    answers: [
      { kind: 'thread', ref: 'T1', decision: 'recorded', reason: 'needed', reply: 'Recorded.' },
    ],
    pushed: null,
    sync: 'none',
    cost: { usd: 0.01, models: ['claude-haiku-5-5'] },
    event: 'issue_comment',
    runUrl: 'https://x/run/4',
    now,
  });
  expect(result.outcome).toBe('done');
});
