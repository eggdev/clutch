import { expect, test } from 'bun:test';

import {
  blockers,
  dryRunComment,
  marker,
  noVerdictYet,
  reactionRequest,
  runAutoMerge,
} from '@tools/github/auto-merge';
import type { Facts } from '@tools/github/auto-merge';
import type { Result, Run } from '@tools/github/stack';

const head = 'a1b2c3d4e5f6';

const facts = (fields: Partial<Facts> = {}, pr: Partial<Facts['pr']> = {}): Facts => ({
  pr: {
    state: 'OPEN',
    isDraft: false,
    baseRefName: 'main',
    headRefName: 'clutch/cl-123-docs',
    headRefOid: head,
    ...pr,
  },
  defaultBranch: 'main',
  tier: 'low',
  checks: { validate: 'success', 'agent-review': 'success' },
  ...fields,
});

test('a low-risk agent PR on the default branch with green checks may merge', () => {
  expect(blockers(facts())).toEqual([]);
});

test('each failed condition gives its own reason', () => {
  expect(
    blockers(
      facts(
        { tier: 'medium', checks: { validate: 'failure', 'agent-review': 'missing' } },
        { isDraft: true, baseRefName: 'clutch/cl-122-lower', headRefName: 'fix/typo' },
      ),
    ),
  ).toEqual([
    'The pull request is a draft.',
    'The base is clutch/cl-122-lower, not main. A stacked PR waits.',
    'The head branch does not start with clutch/cl-.',
    'The risk tier is medium, not low.',
    'The required check validate is failure.',
    'The required check agent-review is missing.',
  ]);
});

test('each dry-run comment carries the head marker, its verdict and the reaction request', () => {
  const would = dryRunComment(facts(), []);
  expect(would.startsWith(marker(head))).toBe(true);
  expect(would).toContain('this pull request would auto-merge at a1b2c3d');
  expect(would.split('\n').at(-1)).toBe(reactionRequest);
  const wouldNot = dryRunComment(facts(), ['The risk tier is medium, not low.']);
  expect(wouldNot.startsWith(marker(head))).toBe(true);
  expect(wouldNot).toContain(
    'would not auto-merge at a1b2c3d.\n\n- The risk tier is medium, not low.',
  );
  expect(wouldNot.split('\n').at(-1)).toBe(reactionRequest);
});

test('no verdict while a required check runs or for a draft or a non-agent branch', () => {
  expect(noVerdictYet(facts())).toBeUndefined();
  expect(
    noVerdictYet(facts({ checks: { validate: 'failure', 'agent-review': 'skipped' } })),
  ).toBeUndefined();
  expect(noVerdictYet(facts({ checks: { validate: 'pending', 'agent-review': 'missing' } }))).toBe(
    'Waiting for validate, agent-review to finish.',
  );
  expect(noVerdictYet(facts({}, { isDraft: true }))).toBe(
    'The pull request is not an open, ready agent PR.',
  );
  expect(noVerdictYet(facts({}, { headRefName: 'fix/typo' }))).toBe(
    'The pull request is not an open, ready agent PR.',
  );
});

/** A fake runner for a green, low-risk agent PR. `answers` override by command prefix. */
function fake(answers: Array<[string, Partial<Result>]> = []) {
  const calls: Array<string> = [];
  const defaults: Array<[string, Partial<Result>]> = [
    ['gh repo view --json nameWithOwner', { out: 'eggdev/clutch\n' }],
    ['gh repo view --json defaultBranchRef', { out: 'main\n' }],
    ['gh pr view', { out: JSON.stringify(facts().pr) }],
    ['gh api repos/eggdev/clutch/rules/branches/main', { out: '["validate"]' }],
    [
      'gh api --paginate repos/eggdev/clutch/commits',
      {
        out: [
          { id: 1, name: 'validate', status: 'completed', conclusion: 'failure' },
          { id: 2, name: 'validate', status: 'completed', conclusion: 'success' },
          { id: 3, name: 'agent-review', status: 'completed', conclusion: 'success' },
        ]
          .map((line) => JSON.stringify(line))
          .join('\n'),
      },
    ],
    ['bun tools/clutch.ts risk', { out: '{"tier":"low"}' }],
    ['gh api --paginate repos/eggdev/clutch/issues/7/comments', { out: 'LGTM\n' }],
  ];
  const run: Run = (command) => {
    const line = command.join(' ');
    calls.push(line);
    const answer = [...answers, ...defaults].find(([prefix]) => line.startsWith(prefix))?.[1];
    return Promise.resolve({ ok: true, out: '', err: '', ...answer });
  };
  return { run, calls };
}

const args = ['--pr', '7', '--head', head];
const acts = (calls: Array<string>) =>
  calls.filter((call) => call.startsWith('gh pr comment') || call.startsWith('gh pr merge'));

/** Runs the decision with `mode` and returns the lines it logged. */
async function decide(gh: ReturnType<typeof fake>, mode: 'off' | 'dry-run' | 'on') {
  const lines: Array<string> = [];
  expect(await runAutoMerge(args, gh.run, mode, (line) => lines.push(line))).toBe(0);
  return lines;
}

test('dry-run comments once, with the latest run of each required check', async () => {
  const gh = fake();
  expect(await decide(gh, 'dry-run')).toEqual(['Would auto-merge.\nPosted the dry-run comment.']);
  expect(acts(gh.calls)).toHaveLength(1);
  expect(acts(gh.calls)[0]).toStartWith(`gh pr comment 7 --body ${marker(head)}`);
});

test('dry-run skips the comment when this head already has one', async () => {
  const gh = fake([
    ['gh api --paginate repos/eggdev/clutch/issues/7/comments', { out: `${marker(head)}\n` }],
  ]);
  expect(await decide(gh, 'dry-run')).toEqual([
    'Would auto-merge.\nThe dry-run comment for this head is already there.',
  ]);
  expect(acts(gh.calls)).toEqual([]);
});

test('a medium-risk agent PR gets a would-not verdict with its reasons', async () => {
  const medium = fake([['bun tools/clutch.ts risk', { out: '{"tier":"medium"}' }]]);
  expect(await decide(medium, 'dry-run')).toEqual([
    'Would not auto-merge:\n- The risk tier is medium, not low.\nPosted the dry-run comment.',
  ]);
  expect(acts(medium.calls)).toHaveLength(1);
  expect(acts(medium.calls)[0]).toContain('would not auto-merge');
});

test('a running check, a non-agent branch or a moved head gets no comment', async () => {
  const running = fake([
    [
      'gh api --paginate repos/eggdev/clutch/commits',
      { out: JSON.stringify({ id: 1, name: 'validate', status: 'in_progress', conclusion: null }) },
    ],
  ]);
  expect(await decide(running, 'dry-run')).toEqual([
    'Would not auto-merge:\n- The required check validate is pending.\n- The required check agent-review is missing.\nNo dry-run comment: Waiting for validate, agent-review to finish.',
  ]);
  expect(acts(running.calls)).toEqual([]);
  const person = fake([
    ['gh pr view', { out: JSON.stringify(facts({}, { headRefName: 'fix/typo' }).pr) }],
  ]);
  await decide(person, 'dry-run');
  expect(acts(person.calls)).toEqual([]);
  const moved = fake([
    ['gh pr view', { out: JSON.stringify(facts({}, { headRefOid: 'ffff' }).pr) }],
  ]);
  expect(await decide(moved, 'dry-run')).toEqual([
    `The head moved from ${head} to ffff. The run for the new head decides.`,
  ]);
  expect(moved.calls.some((call) => call.startsWith('bun tools/clutch.ts risk'))).toBe(false);
});

test('on queues a merge commit only for a green low-risk PR, and off acts on nothing', async () => {
  const on = fake();
  expect(await decide(on, 'on')).toEqual(['Queued the merge.']);
  expect(acts(on.calls)).toEqual(['gh pr merge 7 --auto --merge']);
  const onMedium = fake([['bun tools/clutch.ts risk', { out: '{"tier":"medium"}' }]]);
  expect(await decide(onMedium, 'on')).toEqual([
    'Would not auto-merge:\n- The risk tier is medium, not low.',
  ]);
  expect(acts(onMedium.calls)).toEqual([]);
  const off = fake();
  expect(await decide(off, 'off')).toEqual(['Would auto-merge.']);
  expect(acts(off.calls)).toEqual([]);
});
