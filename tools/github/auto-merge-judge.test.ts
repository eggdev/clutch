import { expect, test } from 'bun:test';

import { app, comments, decide, facts, fake, head, merges } from '@tools/github/auto-merge-fake';
import { blockers, brakeReason, brakedStep } from '@tools/github/auto-merge-rules';
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

/**
 * The merged PRs of the brake's window: `reverts` of the `merged` have a head
 * branch that starts with `revert/`, and the first `drills` of those carry `drill`.
 */
const mergedPrs = (merged: number, reverts: number, drills = 0) =>
  JSON.stringify(
    Array.from({ length: merged }, (_, index) => ({
      headRefName: index < reverts ? `revert/${index + 1}` : `clutch/cl-${index + 1}-docs`,
      labels: index < drills ? [{ name: 'drill' }] : [],
    })),
  );

const countMerged = (out: string): [string, { out: string }] => [
  'gh pr list --state merged',
  { out },
];

test('reverts past 2% of 40 merges brake medium down to low', async () => {
  const gh = fake([
    countMerged(mergedPrs(40, 3)),
    ['bun tools/clutch.ts risk', { out: '{"tier":"medium"}' }],
  ]);
  const [verdict] = await decide(gh, { mode: 'off', step: 'medium' });
  expect(verdict).toContain('Reverts are 3 of 40 merged PRs');
  expect(verdict).toContain('so the step drops from medium to low.');
  expect(verdict).toContain(
    'Would not auto-merge at the step low:\n- The risk tier is medium, not low.',
  );
});

test('a braked run queues the merge at the braked step', async () => {
  const gh = fake([countMerged(mergedPrs(40, 3))]);
  expect(await decide(gh, { mode: 'on', step: 'medium' })).toEqual([
    expect.stringContaining('Would auto-merge at the step low.\nQueued the merge.'),
  ]);
  expect(merges(gh.calls)).toEqual([`gh pr merge 7 --auto --merge --match-head-commit ${head}`]);
  expect(comments(gh.calls)[0]).toContain('at the step `low`');
});

test('1 revert in 60 merges (1.7%) does not brake', async () => {
  const gh = fake([countMerged(mergedPrs(60, 1))]);
  expect(await decide(gh, { mode: 'off', step: 'medium' })).toEqual([
    'Would auto-merge at the step medium.',
  ]);
});

test('a drill revert is merged but not a revert, so 1 drill in 48 merges does not brake', async () => {
  const gh = fake([countMerged(mergedPrs(48, 1, 1))]);
  expect(await decide(gh, { mode: 'off', step: 'medium' })).toEqual([
    'Would auto-merge at the step medium.',
  ]);
});

test('1 real revert in 48 merges (2.08%) brakes, so a drill is the only exception', async () => {
  const gh = fake([
    countMerged(mergedPrs(48, 1)),
    ['bun tools/clutch.ts risk', { out: '{"tier":"medium"}' }],
  ]);
  const [verdict] = await decide(gh, { mode: 'off', step: 'medium' });
  expect(verdict).toContain('Reverts are 1 of 48 merged PRs');
  expect(verdict).toContain('so the step drops from medium to low.');
});

test('exactly 2% does not brake, since the limit is passed only above it', async () => {
  const gh = fake([countMerged(mergedPrs(100, 2))]);
  expect(await decide(gh, { mode: 'off', step: 'medium' })).toEqual([
    'Would auto-merge at the step medium.',
  ]);
});

test('3 reverts in 10 merges do not brake, since the minimum is 20 merges', async () => {
  const gh = fake([countMerged(mergedPrs(10, 3))]);
  expect(await decide(gh, { mode: 'off', step: 'medium' })).toEqual([
    'Would auto-merge at the step medium.',
  ]);
});

test('a failed count call does not brake, and warns', async () => {
  const gh = fake([['gh pr list --state merged', { ok: false, err: 'HTTP 502' }]]);
  const lines = await decide(gh, { mode: 'off', step: 'medium' });
  expect(lines[0]).toStartWith('::warning::Could not count the merged PRs');
  expect(lines[0]).toContain('the step stays medium');
  expect(lines.at(-1)).toBe('Would auto-merge at the step medium.');
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

test('brakedStep steps each level down one, and bots has nowhere lower', () => {
  expect(brakedStep('medium', 40, 3)).toBe('low');
  expect(brakedStep('low', 40, 3)).toBe('bots');
  expect(brakedStep('bots', 40, 3)).toBe('bots');
});

test('brakedStep keeps the step under the rate or the minimum', () => {
  for (const step of ['bots', 'low', 'medium'] as const) {
    expect(brakedStep(step, 60, 1)).toBe(step);
    expect(brakedStep(step, 10, 3)).toBe(step);
    expect(brakedStep(step, 0, 0)).toBe(step);
  }
});

test('brakeReason names the rate, the counts and the step', () => {
  expect(brakeReason(40, 3, 'medium', 'low')).toBe(
    'Reverts are 3 of 40 merged PRs in the last 30d, 7.5%, over the 2% brake, so the step drops from medium to low.',
  );
});
