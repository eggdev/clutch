import { expect, test } from 'bun:test';

import { blockingGuard } from '@tools/github/babysit-answer';
import type { Answer } from '@tools/github/babysit-answer';
import type { Item } from '@tools/github/babysit-log';
import { decisionsNow, onlyOwnerLeft } from '@tools/github/babysit-owner';
import { readPr } from '@tools/github/babysit-read';
import { fake } from '@tools/github/fake-run';

test('a cancelled check is not red, and the log is found among the oldest comments', async () => {
  const log = `## Babysit log\n\n<!-- clutch-babysit-log${JSON.stringify({ version: 1, answered: [5], rounds: [] })}-->`;
  const graph = JSON.stringify({
    data: {
      repository: {
        pullRequest: {
          number: 7,
          url: 'u',
          isDraft: false,
          state: 'OPEN',
          isCrossRepository: false,
          headRefOid: 'abc',
          headRefName: 'clutch/cl-1-x',
          baseRefName: 'main',
          mergeable: 'MERGEABLE',
          author: { login: 'eggdev-clutch-bot', __typename: 'Bot' },
          labels: { nodes: [] },
          commits: {
            nodes: [
              {
                commit: {
                  statusCheckRollup: {
                    contexts: {
                      nodes: [
                        {
                          __typename: 'CheckRun',
                          name: 'sweep',
                          conclusion: 'CANCELLED',
                          status: 'COMPLETED',
                          detailsUrl: '',
                        },
                        {
                          __typename: 'CheckRun',
                          name: 'validate',
                          conclusion: 'FAILURE',
                          status: 'COMPLETED',
                          detailsUrl: '',
                        },
                      ],
                    },
                  },
                },
              },
            ],
          },
          reviewThreads: { nodes: [] },
          oldest: {
            nodes: [
              { databaseId: 1, author: { login: 'app/bot' }, body: log, createdAt: 'x', url: '' },
            ],
          },
          comments: {
            nodes: [
              { databaseId: 1, author: { login: 'app/bot' }, body: log, createdAt: 'x', url: '' },
            ],
          },
          reviews: { nodes: [] },
        },
      },
    },
  });
  const { run } = fake([
    ['gh api graphql -F', { out: graph }],
    ['gh api repos/acme/shop/compare', { out: '0' }],
  ]);
  const read = await readPr(run, 'acme/shop', 7, 'eggdev');
  expect(read.failed.map((c) => c.name)).toEqual(['validate']);
  expect(read.authorIsBot).toBe(true);
  expect(read.logId).toBe(1);
  expect(read.log.answered).toEqual([5]);
  expect(read.comments.length).toBe(1);
});

test('the owner is asked only when nothing but the approval is left', () => {
  const status = {
    counts: { pass: 6, fail: 0, pending: 0 },
    agentReview: { posted: true, blocking: 0, owner: 1 },
    mergeable: 'MERGEABLE',
    mergeState: 'BLOCKED',
    ready: false,
  };
  expect(onlyOwnerLeft(status, false)).toBe(true);
  expect(onlyOwnerLeft({ ...status, counts: { pass: 5, fail: 0, pending: 1 } }, false)).toBe(false);
  expect(
    onlyOwnerLeft({ ...status, agentReview: { posted: true, blocking: 1, owner: 0 } }, false),
  ).toBe(false);
  expect(onlyOwnerLeft(status, true)).toBe(false);
  // An open thread or a stuck round is work left, so the session does not ask yet.
  expect(onlyOwnerLeft(status, false, true)).toBe(false);
  expect(onlyOwnerLeft({ ...status, mergeState: 'CLEAN', ready: true }, false)).toBe(false);
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

const item = (fields: Partial<Item>): Item => ({
  kind: 'thread',
  ref: 'T1',
  url: 'u',
  author: 'bot',
  decision: 'owner',
  reason: 'a policy call',
  action: 'left for the owner',
  resolved: false,
  ...fields,
});

test('a failed check or an unfixed blocking finding left for the owner needs them now', () => {
  const check = item({ kind: 'check', ref: 'deploy', reason: 'a missing secret' });
  const blocking = item({ ref: 'T2', reason: 'a blocking finding closes only with a fix; no' });
  expect(
    decisionsNow([item({}), check, blocking, item({ decision: 'no-change', kind: 'check' })]),
  ).toEqual([check, blocking]);
});
