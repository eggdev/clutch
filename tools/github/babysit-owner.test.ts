import { afterEach, beforeEach, expect, test } from 'bun:test';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { plan, replyMarker } from '@tools/github/babysit';
import { addRound, emptyLog, renderLog } from '@tools/github/babysit-log';
import type { Item, Round } from '@tools/github/babysit-log';
import { ownerAsk, ownerLeft } from '@tools/github/babysit-owner';
import { readPr } from '@tools/github/babysit-read';
import { babysit } from '@tools/github/babysit-session';
import { fake } from '@tools/github/fake-run';

const left: Item = {
  kind: 'thread',
  ref: 'T1',
  url: 'u',
  author: 'bot',
  commentId: 5,
  path: 'a.ts',
  finding: 'owner: which copy?',
  decision: 'owner',
  reason: 'a product decision',
  action: 'left for the owner',
  resolved: false,
};

const roundOf = (head: string, items: Array<Item>): Round => ({
  at: '2026-11-08T10:00:00Z',
  run: '',
  event: 'session',
  triggers: ['open-thread'],
  head,
  sync: 'none',
  items,
  pushed: null,
  cost: { usd: 0, models: [] },
  outcome: 'waiting-owner',
  note: '',
});

const node = (id: number, body: string) => ({
  databaseId: id,
  author: { login: 'bot' },
  body,
  createdAt: '2026-11-08T09:00:00Z',
  url: 'u',
});

/** A PR at `head` whose log holds `rounds`, with two threads where the babysitter spoke last. */
function pr(head: string, rounds: Array<Round>, mergeState: string) {
  let all = emptyLog();
  for (const round of rounds) {
    all = addRound(all, round, []);
  }
  const log = node(900, renderLog(all));
  const open = (id: string, first: number) => ({
    id,
    isResolved: false,
    isOutdated: false,
    path: 'a.ts',
    line: 1,
    comments: { nodes: [node(first, 'owner: which copy?'), node(6, `Left.\n\n${replyMarker}`)] },
  });
  const graph = {
    data: {
      repository: {
        pullRequest: {
          number: 7,
          isDraft: false,
          state: 'OPEN',
          isCrossRepository: false,
          author: { login: 'eggdev', __typename: 'User' },
          headRefOid: head,
          headRefName: 'clutch/cl-1-x',
          baseRefName: 'main',
          labels: { nodes: [] },
          mergeable: 'MERGEABLE',
          commits: { nodes: [{ commit: { statusCheckRollup: { contexts: { nodes: [] } } } }] },
          reviewThreads: { nodes: [open('T1', 5), open('T2', 7)] },
          oldest: { nodes: [log] },
          comments: { nodes: [log] },
          reviews: { nodes: [] },
        },
      },
    },
  };
  const view = {
    number: 7,
    url: 'https://github.com/a/b/pull/7',
    state: 'OPEN',
    headRefOid: head,
    headRefName: 'clutch/cl-1-x',
    baseRefName: 'main',
    mergeable: 'MERGEABLE',
    mergeStateStatus: mergeState,
    reviewDecision: '',
    statusCheckRollup: [
      { __typename: 'CheckRun', name: 'agent-review', status: 'COMPLETED', conclusion: 'SUCCESS' },
    ],
  };
  return [
    ['gh api graphql', { out: JSON.stringify(graph) }],
    ['gh pr view', { out: JSON.stringify(view) }],
    [
      'gh api --paginate repos/{owner}/{repo}/issues/7/comments',
      { out: `${JSON.stringify({ body: '## Agent review\nBlocking: 0', login: 'agent[bot]' })}\n` },
    ],
    ['gh api repos/{owner}/{repo}/rules', { out: '[]' }],
  ] as Array<[string, { out: string }]>;
}

const leftOn = (head: string, rounds: Array<Round>, mergeState: string) =>
  ownerLeft(fake(pr(head, rounds, mergeState)).run, 'a/b', 'eggdev', 7);

test('a decision left on an older head still waits after a push', async () => {
  expect(await leftOn('n3w', [roundOf('0ld', [left])], 'CLEAN')).toEqual({
    held: false,
    refs: ['T1'],
  });
});

test('a named decision never sends the owner to the PR', async () => {
  const found = await leftOn('h3ad', [roundOf('h3ad', [left])], 'BLOCKED');
  const ask = ownerAsk({
    repo: 'a/b',
    number: '7',
    head: 'h3ad',
    stuck: false,
    left: found,
    now: [],
  });
  expect(ask?.text).toContain('T1 wait for the owner');
  expect(ask?.text).not.toContain('/files');
});

test('a later round that closes the item stops the ask', async () => {
  const closed = { ...left, resolved: true };
  expect(
    await leftOn('h3ad', [roundOf('0ld', [left]), roundOf('h3ad', [closed])], 'CLEAN'),
  ).toBeNull();
});

test('an item with no answer from the session does not wait for the owner', async () => {
  const skipped = { ...left, reason: 'the agent gave no decision' };
  expect(await leftOn('h3ad', [roundOf('h3ad', [skipped])], 'CLEAN')).toBeNull();
});

test('only the waiting thread can close with the owner answer', async () => {
  const fixFailed = { ...left, ref: 'T2', decision: 'must-fix' as const };
  const state = await readPr(
    fake(pr('h3ad', [roundOf('h3ad', [left, fixFailed])], 'CLEAN')).run,
    'a/b',
    7,
    'eggdev',
  );
  expect(plan(state, '2026-11-08T11:00:00Z').ownerThreads.map((t) => t.id)).toEqual(['T1']);
});

let gitDir = '';
beforeEach(async () => {
  gitDir = await mkdtemp(path.join(tmpdir(), 'babysit-owner-'));
  await mkdir(path.join(gitDir, 'clutch'), { recursive: true });
});
afterEach(() => rm(gitDir, { recursive: true, force: true }));

const keep = (skip: string, stuck = false) =>
  writeFile(
    path.join(gitDir, 'clutch', 'babysit-7.json'),
    JSON.stringify({
      number: 7,
      head: 'h3ad',
      approved: false,
      triggers: [],
      sync: 'none',
      failed: [],
      threads: [],
      comments: [],
      approvedThreads: [],
      waiting: [left],
      ownerThreads: [
        { id: 'T1', commentId: 5, path: 'a.ts', line: 1, outdated: false, comments: [] },
      ],
      skip,
      stuck,
    }),
  );

const session = () =>
  fake([
    ['gh repo view', { out: 'a/b\n' }],
    ['git rev-parse --absolute-git-dir', { out: `${gitDir}\n` }],
    ...pr('h3ad', [], 'CLEAN'),
  ]);

test('the owner answer quotes itself in the waiting thread, and resolves it', async () => {
  await keep('nothing to do');
  const gh = session();
  expect(
    await babysit(gh.run, '7', { 'owner-said': 'Keep 3 clicks.', now: '2026-11-08T11:00:00Z' }),
  ).toBe(0);
  expect(
    gh.calls.some((c) => c.includes('comments/5/replies') && c.includes('Keep 3 clicks.')),
  ).toBe(true);
  expect(gh.calls.some((c) => c.includes('resolveReviewThread') && c.includes('T1'))).toBe(true);
});

test('the owner answer does not reach a PR labelled off', async () => {
  await keep('labelled babysit:off');
  await expect(
    babysit(session().run, '7', { 'owner-said': 'Yes.', now: '2026-11-08T11:00:00Z' }),
  ).rejects.toThrow('No round for #7');
});
