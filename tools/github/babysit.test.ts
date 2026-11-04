import { expect, test } from 'bun:test';

import {
  behindLimit,
  isAgentPr,
  plan,
  replyMarker,
  roundsPerDay,
  roundsPerTrigger,
  stuckLabel,
} from '@tools/github/babysit';
import { actionOf, afterApproval, blockingGuard, resolves } from '@tools/github/babysit-answer';
import type { Answer } from '@tools/github/babysit-answer';
import { apply, outcomeOf } from '@tools/github/babysit-apply';
import { emptyLog, roundsToday } from '@tools/github/babysit-log';
import type { Round } from '@tools/github/babysit-log';
import { ownerStep } from '@tools/github/babysit-owner';
import type { PrState, Thread } from '@tools/github/babysit-read';
import { fake } from '@tools/github/fake-run';

const now = '2026-11-04T12:00:00Z';

const thread = (id: string, last = 'note: rename this'): Thread => ({
  id,
  path: 'tools/x.ts',
  line: 3,
  outdated: false,
  commentId: 11,
  comments: [{ id: 11, author: 'github-actions', body: last, at: now, url: 'https://x/c11' }],
});

const state = (fields: Partial<PrState> = {}): PrState => ({
  number: 7,
  url: 'https://github.com/acme/shop/pull/7',
  draft: false,
  open: true,
  fork: false,
  author: 'app/eggdev-clutch-bot',
  authorIsBot: true,
  head: 'abc1234def',
  headRef: 'clutch/cl-420-babysit',
  base: 'main',
  labels: [],
  mergeable: 'MERGEABLE',
  behindBy: 0,
  failed: [],
  pending: 0,
  threads: [],
  comments: [],
  approved: false,
  log: emptyLog(),
  logId: null,
  ...fields,
});

const round = (fields: Partial<Round> = {}): Round => ({
  at: now,
  run: 'https://x/run/1',
  event: 'schedule',
  triggers: ['open-thread'],
  head: 'abc1234def',
  sync: 'none',
  items: [],
  pushed: null,
  cost: { usd: 0.01, models: ['claude-haiku-5-5'] },
  outcome: 'done',
  note: '',
  ...fields,
});

test('a clean PR needs no round', () => {
  expect(plan(state(), now).skip).toBe('nothing to do');
});

test('each kind of work is a trigger', () => {
  const next = plan(
    state({
      mergeable: 'CONFLICTING',
      failed: [{ name: 'validate', url: 'https://x/actions/runs/9/job/1' }],
      threads: [thread('T1')],
      comments: [{ id: 5, author: 'eggdev', body: 'Why this name?', at: now, url: 'https://x/c5' }],
    }),
    now,
  );
  expect(next.skip).toBeNull();
  expect(next.triggers).toEqual(['conflict', 'red-check', 'open-thread', 'new-comment']);
  expect(next.sync).toBe('conflict');
});

test('a branch far behind its base gets a merge sync', () => {
  expect(plan(state({ behindBy: behindLimit }), now).sync).toBe('merge');
  expect(plan(state({ behindBy: behindLimit - 1 }), now).skip).toBe('nothing to do');
});

test('a red check waits until no check is pending', () => {
  const failed = [{ name: 'validate', url: '' }];
  expect(plan(state({ failed, pending: 1 }), now).skip).toBe('nothing to do');
});

test('a thread where the babysitter spoke last, and machine comments, are not work', () => {
  const next = plan(
    state({
      threads: [thread('T1', `owner decides\n\n${replyMarker}`)],
      comments: [
        {
          id: 1,
          author: 'github-actions',
          body: '## Agent review\n\nNo findings.',
          at: now,
          url: '',
        },
        {
          id: 2,
          author: 'app/eggdev-clutch-bot',
          body: 'x <!-- automerge-dry-run:abc -->',
          at: now,
          url: '',
        },
        { id: 3, author: 'eggdev', body: '## Review disposition\n', at: now, url: '' },
      ],
    }),
    now,
  );
  expect(next.skip).toBe('nothing to do');
});

test('a comment the log answered is not asked again', () => {
  const comments = [{ id: 5, author: 'cursor[bot]', body: 'Possible bug', at: now, url: '' }];
  expect(plan(state({ comments }), now).triggers).toEqual(['new-comment']);
  expect(plan(state({ comments, log: { version: 1, answered: [5], rounds: [] } }), now).skip).toBe(
    'nothing to do',
  );
});

test('only agent PRs, never a fork, a draft or a PR labelled off', () => {
  const pr = { author: 'eggdev', authorIsBot: false, fork: false };
  expect(isAgentPr({ ...pr, headRef: 'feature/x' })).toBe(false);
  expect(isAgentPr({ ...pr, headRef: 'clutch/cl-1-x' })).toBe(true);
  expect(
    isAgentPr({ author: 'eggdev-clutch-bot', authorIsBot: true, headRef: 'x', fork: true }),
  ).toBe(false);
  // A Renovate PR is a bot PR, which auto-merge judges by the bot rule, not an agent PR.
  expect(
    isAgentPr({ author: 'renovate', authorIsBot: true, headRef: 'renovate/x', fork: false }),
  ).toBe(false);
  const work = { threads: [thread('T1')] };
  expect(plan(state({ ...work, draft: true }), now).skip).toBe('closed or draft');
  expect(plan(state({ ...work, labels: ['babysit:off'] }), now).skip).toBe('labelled babysit:off');
});

test('the same work on the same head stops after the cap, and is stuck', () => {
  const rounds = Array.from({ length: roundsPerTrigger }, () => round());
  const next = plan(
    state({ threads: [thread('T1')], log: { version: 1, answered: [], rounds } }),
    now,
  );
  expect(next.stuck).toBe(true);
  expect(next.skip).toContain('already met the same work');
  // A new head is new work.
  expect(
    plan(
      state({
        head: 'fff0000',
        threads: [thread('T1')],
        log: { version: 1, answered: [], rounds },
      }),
      now,
    ).skip,
  ).toBeNull();
});

test('the daily cap counts the rounds of the UTC day', () => {
  const rounds = Array.from({ length: roundsPerDay }, (_, i) => round({ head: `h${i}` }));
  const log = { version: 1 as const, answered: [], rounds };
  expect(roundsToday(log, now)).toBe(roundsPerDay);
  expect(plan(state({ threads: [thread('T1')], log }), now).skip).toBe(
    `${roundsPerDay} rounds today already`,
  );
  expect(roundsToday(log, '2026-11-05T00:01:00Z')).toBe(0);
});

test('a stuck PR waits for a new head or a person', () => {
  const log = {
    version: 1 as const,
    answered: [],
    rounds: [round({ outcome: 'stuck', at: '2026-11-04T11:00:00Z' })],
  };
  const base = { labels: [stuckLabel], log, threads: [thread('T1')] };
  expect(plan(state(base), now).skip).toBe(`labelled ${stuckLabel}`);
  const comments = [{ id: 9, author: 'eggdev', body: 'Try a merge instead.', at: now, url: '' }];
  expect(plan(state({ ...base, comments }), now).skip).toBeNull();
});

test('only a pushed fix or a no-change resolves a thread', () => {
  expect(resolves('must-fix', 'abc')).toBe(true);
  expect(resolves('must-fix', null)).toBe(false);
  expect(resolves('no-change', null)).toBe(true);
  expect(resolves('owner', 'abc')).toBe(false);
  expect(actionOf('cheap-fix', 'abcdef123')).toBe('fixed in abcdef1');
});

test('after the approval a cheap fix waits, and a must-fix still pushes', () => {
  const answers: Array<Answer> = [
    { kind: 'thread', ref: 'T1', decision: 'cheap-fix', reason: '', reply: '' },
    { kind: 'thread', ref: 'T2', decision: 'must-fix', reason: '', reply: '' },
  ];
  expect(afterApproval(answers, true).map((a) => a.decision)).toEqual([
    'after-approval',
    'must-fix',
  ]);
  expect(afterApproval(answers, false)).toEqual(answers);
});

test('an owner item leaves the round waiting for the owner', () => {
  const item = {
    kind: 'thread' as const,
    ref: 'T',
    url: '',
    author: '',
    reason: '',
    action: '',
    resolved: false,
  };
  expect(outcomeOf([{ ...item, decision: 'owner' }], null, 'none').outcome).toBe('waiting-owner');
  expect(outcomeOf([{ ...item, decision: 'no-change' }], null, 'none').outcome).toBe('done');
  expect(outcomeOf([], null, 'conflict-stuck').outcome).toBe('stuck');
});

test('apply replies in each thread, resolves the answered ones, reruns a flaky check and writes the log', async () => {
  const graph = JSON.stringify({
    data: {
      repository: {
        pullRequest: {
          number: 7,
          url: 'u',
          isDraft: false,
          state: 'OPEN',
          isCrossRepository: false,
          headRefOid: 'abc1234def',
          headRefName: 'clutch/cl-1-x',
          baseRefName: 'main',
          mergeable: 'MERGEABLE',
          author: { login: 'app/bot' },
          labels: { nodes: [] },
          commits: { nodes: [] },
          reviewThreads: { nodes: [] },
          comments: { nodes: [] },
          reviews: { nodes: [] },
        },
      },
    },
  });
  const { run, calls } = fake([
    ['gh api graphql -F', { out: graph }],
    ['gh api repos/acme/shop/compare', { out: '0' }],
  ]);
  const next = plan(
    state({
      threads: [thread('T1'), thread('T2'), thread('T3')],
      failed: [{ name: 'journeys', url: 'https://github.com/acme/shop/actions/runs/99/job/1' }],
      comments: [
        { id: 5, author: 'eggdev', body: 'Is this needed?', at: now, url: 'https://x/c5' },
      ],
    }),
    now,
  );
  const answers: Array<Answer> = [
    { kind: 'thread', ref: 'T1', decision: 'must-fix', reason: 'real', reply: 'Renamed.' },
    {
      kind: 'thread',
      ref: 'T2',
      decision: 'no-change',
      reason: 'already checked',
      reply: 'The caller checks it.',
    },
    { kind: 'thread', ref: 'T3', decision: 'owner', reason: 'policy', reply: 'The owner decides.' },
    { kind: 'check', ref: 'journeys', decision: 'flaky', reason: 'timeout', reply: '' },
    {
      kind: 'comment',
      ref: '5',
      decision: 'no-change',
      reason: 'yes',
      reply: 'Yes, the sweep reads it.',
    },
  ];
  const result = await apply(run, {
    repo: 'acme/shop',
    owner: 'eggdev',
    plan: next,
    answers,
    pushed: 'feed123abc',
    sync: 'none',
    cost: { usd: 0.02, models: ['claude-haiku-5-5'] },
    event: 'issue_comment',
    runUrl: 'https://x/run/2',
    now,
  });
  const resolved = calls
    .filter((c) => c.includes('resolveReviewThread'))
    .map((c) => /threadId: "(\w+)"/u.exec(c)?.[1]);
  expect(resolved).toEqual(['T1', 'T2']);
  expect(calls.filter((c) => c.includes('/replies')).length).toBe(3);
  expect(calls.some((c) => c.startsWith('gh run rerun 99 --failed'))).toBe(true);
  expect(
    calls.some((c) => c.startsWith('gh pr comment 7') && c.includes('Babysitter replies')),
  ).toBe(true);
  expect(calls.some((c) => c.startsWith('gh pr comment 7') && c.includes('## Babysit log'))).toBe(
    true,
  );
  expect(result.outcome).toBe('waiting-owner');
  expect(result.items.find((i) => i.ref === 'T1')?.action).toBe('fixed in feed123');
});

test('the owner is asked only when nothing but the approval is left', () => {
  const status = {
    counts: { pass: 6, fail: 0, pending: 0 },
    agentReview: { posted: true, blocking: 0, owner: 1 },
    mergeable: 'MERGEABLE',
    mergeState: 'BLOCKED',
    ready: false,
  };
  expect(ownerStep(status, false, false)).toBe('ask');
  expect(ownerStep(status, false, true)).toBe('keep');
  expect(ownerStep({ ...status, counts: { pass: 5, fail: 0, pending: 1 } }, false, true)).toBe(
    'withdraw',
  );
  expect(
    ownerStep({ ...status, agentReview: { posted: true, blocking: 1, owner: 0 } }, false, false),
  ).toBe('keep');
  expect(ownerStep(status, true, true)).toBe('keep');
  expect(ownerStep({ ...status, mergeState: 'CLEAN', ready: true }, false, false)).toBe('keep');
});

test("the owner's approval answers the threads left for the owner, with no model", () => {
  const left = thread('T9', `The owner decides.\n\n${replyMarker}`);
  expect(plan(state({ threads: [left] }), now).skip).toBe('nothing to do');
  const next = plan(state({ threads: [left], approved: true }), now);
  expect(next.triggers).toEqual(['owner-approved']);
  expect(next.approvedThreads.map((t) => t.id)).toEqual(['T9']);
  expect(next.threads).toEqual([]);
});

test('only a fix closes a blocking finding; any other answer leaves it for the owner', () => {
  const answer: Answer = {
    kind: 'thread',
    ref: 'T1',
    decision: 'no-change',
    reason: 'wrong',
    reply: 'No.',
  };
  expect(blockingGuard(answer, 'blocking: docs did not move')?.decision).toBe('owner');
  expect(blockingGuard(answer, '**blocking** (review.md)')?.decision).toBe('owner');
  expect(blockingGuard({ ...answer, decision: 'must-fix' }, 'blocking: x')?.decision).toBe(
    'must-fix',
  );
  expect(blockingGuard(answer, 'note: rename')?.decision).toBe('no-change');
  expect(blockingGuard(undefined, 'blocking: x')).toBeUndefined();
});
