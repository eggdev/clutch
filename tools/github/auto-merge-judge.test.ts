import { expect, test } from 'bun:test';

import { app, comments, decide, facts, fake, head, merges } from '@tools/github/auto-merge-fake';
import { blockers } from '@tools/github/auto-merge-rules';
import type { Result } from '@tools/github/stack';

test('a person-opened PR on a feature branch is refused and never commented', async () => {
  const person = fake([], { headRefName: 'feature/x' });
  expect(await decide(person, { mode: 'dry-run', step: 'medium' })).toEqual([
    'Not judged: A person opened this pull request. Open it with `bun run pr open`, so the release bot opens it.',
  ]);
  expect([...merges(person.calls), ...comments(person.calls)]).toEqual([]);
});

test('a bot-authored PR on a feature branch merges at the step low like an agent PR', async () => {
  const gh = fake([], { headRefName: 'feature/x', author: app });
  expect(await decide(gh, { mode: 'on', step: 'low' })).toEqual([
    'Would auto-merge at the step low.\nQueued the merge.',
  ]);
  expect(merges(gh.calls)).toEqual([`gh pr merge 7 --auto --merge --match-head-commit ${head}`]);
});

/** A check run that fails validate on the default branch's head, `mainsha`. */
const redMain: [string, Partial<Result>] = [
  'gh api --paginate repos/eggdev/clutch/commits/mainsha',
  {
    out: JSON.stringify({
      id: 9,
      name: 'validate',
      status: 'completed',
      conclusion: 'failure',
      app: 'github-actions',
    }),
  },
];

test('a revert of an auto-merged PR merges at every step while main is red', async () => {
  const gh = fake(
    [['gh api --paginate repos/eggdev/clutch/issues/5/comments', { out: '901\n' }], redMain],
    { headRefName: 'revert/5', author: app },
  );
  expect(await decide(gh, { mode: 'on', step: 'bots' })).toEqual([
    'Would auto-merge at the step bots.\nQueued the merge.',
  ]);
  expect(merges(gh.calls)).toEqual([`gh pr merge 7 --auto --merge --match-head-commit ${head}`]);
});

test('a revert of a PR that a person merged waits for a person', async () => {
  const gh = fake([], { headRefName: 'revert/5', author: app });
  expect(await decide(gh, { mode: 'on', step: 'medium' })).toEqual([
    'Would not auto-merge at the step medium:\n- #5 was not merged by auto-merge, so a person merges its revert.',
  ]);
  expect(merges(gh.calls)).toEqual([]);
  expect(comments(gh.calls)).toEqual([]);
});

test('a revert whose own risk tier is high does not merge, even of an auto-merged PR', async () => {
  const gh = fake(
    [
      ['gh api --paginate repos/eggdev/clutch/issues/5/comments', { out: '901\n' }],
      ['bun tools/clutch.ts risk', { out: '{"tier":"high"}' }],
    ],
    { headRefName: 'revert/5', author: app },
  );
  expect(await decide(gh, { mode: 'on', step: 'medium' })).toEqual([
    'Would not auto-merge at the step medium:\n- The risk tier is high, not low or medium.',
  ]);
  expect(merges(gh.calls)).toEqual([]);
});

test('a revert skips the red-main reason but keeps its other reasons', () => {
  const reverting = { headRefName: 'revert/5', author: app };
  expect(blockers(facts({ mainRed: ['validate'] }, reverting), 'bots')).toEqual([]);
  expect(
    blockers(
      facts({ mainRed: ['validate'], ownerFindings: ['It lowers a budget.'] }, reverting),
      'bots',
    ),
  ).toEqual(['Agent review asks the owner: It lowers a budget.']);
  expect(
    blockers(facts({ mainRed: ['validate'], checks: { validate: 'pending' } }, reverting), 'bots'),
  ).toEqual(['The required check validate is pending.']);
});

test('on at the last step posts no dry-run comment', async () => {
  const gh = fake([['bun tools/clutch.ts risk', { out: '{"tier":"high"}' }]]);
  expect(await decide(gh, { mode: 'on', step: 'medium' })).toEqual([
    'Would not auto-merge at the step medium:\n- The risk tier is high, not low or medium.\nNo dry-run comment: the step medium is the last.',
  ]);
  expect(comments(gh.calls)).toEqual([]);
  expect(merges(gh.calls)).toEqual([]);
});

test('a medium gardening PR may merge at the step bots', async () => {
  const gh = fake([['bun tools/clutch.ts risk', { out: '{"tier":"medium"}' }]], {
    headRefName: 'gardening/friction-1',
    author: app,
  });
  expect(await decide(gh, { mode: 'on', step: 'bots' })).toEqual([
    'Would auto-merge at the step bots.\nQueued the merge.',
  ]);
  expect(merges(gh.calls)).toHaveLength(1);
});

test('a high gardening PR is refused, as not low or medium', async () => {
  const gh = fake([['bun tools/clutch.ts risk', { out: '{"tier":"high"}' }]], {
    headRefName: 'gardening/friction-1',
    author: app,
  });
  expect(await decide(gh, { mode: 'on', step: 'bots' })).toEqual([
    "Would not auto-merge at the step bots:\n- The gardening PR's risk tier is high, not low or medium.",
  ]);
  expect(merges(gh.calls)).toEqual([]);
});
