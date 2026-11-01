import { expect, test } from 'bun:test';

import { runAutoMerge } from '@tools/github/auto-merge';
import {
  blockers,
  dryRunComment,
  enabledMarker,
  marker,
  nextStep,
  noVerdictYet,
  reactionRequest,
} from '@tools/github/auto-merge-rules';
import type { Config, Facts } from '@tools/github/auto-merge-rules';
import type { Result, Run } from '@tools/github/stack';

const head = 'a1b2c3d4e5f6';
const agent = { login: 'eggdev', is_bot: false };
const app = { login: 'app/renovate', is_bot: true };

const facts = (fields: Partial<Facts> = {}, pr: Partial<Facts['pr']> = {}): Facts => ({
  pr: {
    state: 'OPEN',
    isDraft: false,
    baseRefName: 'main',
    headRefName: 'clutch/cl-123-docs',
    headRefOid: head,
    author: agent,
    ...pr,
  },
  defaultBranch: 'main',
  tier: 'low',
  checks: { validate: 'success', 'agent-review': 'success' },
  botProblems: [],
  mainRed: [],
  ...fields,
});

test('each step takes the PRs of the steps before it', () => {
  const renovate = facts({ tier: 'one-way-door' }, { headRefName: 'renovate/x', author: app });
  const low = facts();
  const medium = facts({ tier: 'medium' });
  const high = facts({ tier: 'high' });
  expect([renovate, low, medium, high].map((item) => blockers(item, 'bots').length === 0)).toEqual([
    true,
    false,
    false,
    false,
  ]);
  expect([renovate, low, medium, high].map((item) => blockers(item, 'low').length === 0)).toEqual([
    true,
    true,
    false,
    false,
  ]);
  expect(
    [renovate, low, medium, high].map((item) => blockers(item, 'medium').length === 0),
  ).toEqual([true, true, true, false]);
  expect(blockers(low, 'bots')).toEqual([
    'Agent PRs auto-merge from the step low. The step is bots.',
  ]);
  expect(blockers(high, 'medium')).toEqual(['The risk tier is high, not low or medium.']);
  expect(nextStep('bots')).toBe('low');
  expect(nextStep('medium')).toBe('medium');
});

test('a bot branch needs a bot author and a diff that passes the bot rule', () => {
  expect(blockers(facts({}, { headRefName: 'renovate/x', author: agent }), 'medium')).toEqual([
    'The author of the renovate branch is not a bot.',
  ]);
  expect(
    blockers(
      facts(
        { botProblems: ['tools/x.ts is not a dependency file.'] },
        { headRefName: 'renovate/x', author: app },
      ),
      'bots',
    ),
  ).toEqual(['tools/x.ts is not a dependency file.']);
  expect(blockers(facts({}, { headRefName: 'fix/typo' }), 'medium')).toEqual([
    "The head branch is neither an agent's (clutch/cl-) nor a bot's (renovate/, gardening/).",
  ]);
});

test('every failed condition gives its own reason, and a red main blocks everything', () => {
  expect(
    blockers(
      facts(
        {
          tier: 'medium',
          checks: { validate: 'failure', 'agent-review': 'missing' },
          mainRed: ['validate'],
        },
        { isDraft: true, baseRefName: 'clutch/cl-122-lower' },
      ),
      'low',
    ),
  ).toEqual([
    'The pull request is a draft.',
    'The base is clutch/cl-122-lower, not main. A stacked PR waits.',
    'The risk tier is medium, not low.',
    'The required check validate is failure.',
    'The required check agent-review is missing.',
    'The required check validate is red on main. Nothing merges until it is green.',
  ]);
});

test('each dry-run comment carries the marker, the verdict, the step and the reaction request', () => {
  const would = dryRunComment(facts(), [], 'low');
  expect(would.startsWith(marker(head))).toBe(true);
  expect(would).toContain('this pull request would auto-merge at a1b2c3d.\n\nAt the step `low`:');
  expect(would.split('\n').at(-1)).toBe(reactionRequest);
  const wouldNot = dryRunComment(facts(), ['The risk tier is medium, not low.'], 'low');
  expect(wouldNot).toContain('would not auto-merge at a1b2c3d.');
  expect(wouldNot).toContain('- The risk tier is medium, not low.');
  expect(wouldNot.startsWith(marker(head))).toBe(true);
  expect(wouldNot.split('\n').at(-1)).toBe(reactionRequest);
});

test('no verdict while a required check runs or for a draft or a non-agent branch', () => {
  expect(noVerdictYet(facts())).toBeUndefined();
  // A finished check, even a failed or skipped one, is no reason to wait.
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

/** Check runs of the head: a failed validate, then a newer one with `conclusion`. */
const runs = (conclusion: string) =>
  [
    { id: 1, name: 'validate', status: 'completed', conclusion: 'failure' },
    { id: 2, name: 'validate', status: 'completed', conclusion },
    { id: 3, name: 'agent-review', status: 'completed', conclusion: 'success' },
  ]
    .map((line) => JSON.stringify({ ...line, app: 'github-actions' }))
    .join('\n');

/** A fake runner for a green, low-risk agent PR on a green main. `answers` override by prefix. */
function fake(answers: Array<[string, Partial<Result>]> = [], pr: Partial<Facts['pr']> = {}) {
  const calls: Array<string> = [];
  const defaults: Array<[string, Partial<Result>]> = [
    ['gh repo view --json nameWithOwner', { out: 'eggdev/clutch\n' }],
    ['gh repo view --json defaultBranchRef', { out: 'main\n' }],
    ['gh pr view', { out: JSON.stringify(facts({}, pr).pr) }],
    ['gh api repos/eggdev/clutch/rules/branches/main', { out: '["validate"]' }],
    ['gh api repos/eggdev/clutch/commits/main --jq .sha', { out: 'mainsha\n' }],
    ['gh api --paginate repos/eggdev/clutch/commits/', { out: runs('success') }],
    ['bun tools/clutch.ts risk', { out: '{"tier":"low"}' }],
    ['gh api --paginate repos/eggdev/clutch/issues/7/comments', { out: 'LGTM\n' }],
    [
      'gh api --paginate repos/eggdev/clutch/pulls/7/files',
      { out: JSON.stringify({ filename: 'bun.lock', patch: '-a\n+b' }) },
    ],
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
const merges = (calls: Array<string>) => calls.filter((call) => call.startsWith('gh pr merge'));
const comments = (calls: Array<string>) => calls.filter((call) => call.startsWith('gh pr comment'));

async function decide(gh: ReturnType<typeof fake>, config: Config) {
  const lines: Array<string> = [];
  expect(await runAutoMerge(args, gh.run, config, (line) => lines.push(line))).toBe(0);
  return lines;
}

test('on at the step bots queues a Renovate PR with a version-only diff, and says so once', async () => {
  const renovate = { headRefName: 'renovate/all-minor', author: app };
  const gh = fake([['bun tools/clutch.ts risk', { out: '{"tier":"one-way-door"}' }]], renovate);
  expect(await decide(gh, { mode: 'on', step: 'bots' })).toEqual([
    'Would auto-merge at the step bots.\nQueued the merge.',
  ]);
  expect(merges(gh.calls)).toEqual([`gh pr merge 7 --auto --merge --match-head-commit ${head}`]);
  expect(comments(gh.calls)).toHaveLength(1);
  expect(comments(gh.calls)[0]).toContain(enabledMarker('bots', head));
  const again = fake(
    [
      ['bun tools/clutch.ts risk', { out: '{"tier":"one-way-door"}' }],
      [
        'gh api --paginate repos/eggdev/clutch/issues/7/comments',
        { out: enabledMarker('bots', head) },
      ],
    ],
    renovate,
  );
  await decide(again, { mode: 'on', step: 'bots' });
  expect(comments(again.calls)).toEqual([]);
});

test('on never queues a Renovate PR that changes more than versions', async () => {
  const gh = fake(
    [
      [
        'gh api --paginate repos/eggdev/clutch/pulls/7/files',
        { out: JSON.stringify({ filename: 'tools/x.ts', patch: '+x' }) },
      ],
    ],
    { headRefName: 'renovate/all-minor', author: app },
  );
  expect(await decide(gh, { mode: 'on', step: 'medium' })).toEqual([
    'Would not auto-merge at the step medium:\n- tools/x.ts is not a dependency file.',
  ]);
  expect(merges(gh.calls)).toEqual([]);
});

test('on never queues while a required check is red on main', async () => {
  const gh = fake(
    [
      [
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
      ],
    ],
    { headRefName: 'gardening/2026-11-02', author: app },
  );
  const [line] = await decide(gh, { mode: 'on', step: 'bots' });
  expect(line).toContain('The required check validate is red on main.');
  expect(merges(gh.calls)).toEqual([]);
});

test('on at the step bots leaves an agent PR to a person, and comments the low verdict', async () => {
  const gh = fake();
  expect(await decide(gh, { mode: 'on', step: 'bots' })).toEqual([
    'Would not auto-merge at the step bots:\n- Agent PRs auto-merge from the step low. The step is bots.\nPosted the dry-run comment for the step low.',
  ]);
  expect(merges(gh.calls)).toEqual([]);
  expect(comments(gh.calls)[0]).toContain('this pull request would auto-merge at a1b2c3d.');
  expect(comments(gh.calls)[0]).toContain('At the step `low`:');
});

test('on at the step low queues a low-risk agent PR, and medium takes a medium one', async () => {
  const low = fake();
  await decide(low, { mode: 'on', step: 'low' });
  expect(merges(low.calls)).toEqual([`gh pr merge 7 --auto --merge --match-head-commit ${head}`]);
  const medium = fake([['bun tools/clutch.ts risk', { out: '{"tier":"medium"}' }]]);
  await decide(medium, { mode: 'on', step: 'low' });
  expect(merges(medium.calls)).toEqual([]);
  await decide(medium, { mode: 'on', step: 'medium' });
  expect(merges(medium.calls)).toEqual([
    `gh pr merge 7 --auto --merge --match-head-commit ${head}`,
  ]);
});

test('dry-run comments the verdict at its step, once per head, and merges nothing', async () => {
  const gh = fake();
  expect(await decide(gh, { mode: 'dry-run', step: 'low' })).toEqual([
    'Would auto-merge at the step low.\nPosted the dry-run comment for the step low.',
  ]);
  expect(merges(gh.calls)).toEqual([]);
  const seen = fake([
    ['gh api --paginate repos/eggdev/clutch/issues/7/comments', { out: marker(head) }],
  ]);
  expect(await decide(seen, { mode: 'dry-run', step: 'low' })).toEqual([
    'Would auto-merge at the step low.\nThe dry-run comment for this head is already there.',
  ]);
});

test('a person branch, a moved head or off mode acts on nothing', async () => {
  const person = fake([], { headRefName: 'fix/typo' });
  expect(await decide(person, { mode: 'on', step: 'medium' })).toEqual([
    "Not judged: The head branch is neither an agent's (clutch/cl-) nor a bot's (renovate/, gardening/).",
  ]);
  const moved = fake([], { headRefOid: 'ffff' });
  expect(await decide(moved, { mode: 'on', step: 'medium' })).toEqual([
    `The head moved from ${head} to ffff. The run for the new head decides.`,
  ]);
  expect(moved.calls.some((call) => call.startsWith('bun tools/clutch.ts risk'))).toBe(false);
  const off = fake();
  expect(await decide(off, { mode: 'off', step: 'medium' })).toEqual([
    'Would auto-merge at the step medium.',
  ]);
  expect([...merges(off.calls), ...comments(off.calls)]).toEqual([]);
});

test('with a handoff, on passes the step to the merge job and merges nothing itself', async () => {
  const gh = fake([], { headRefName: 'renovate/all-minor', author: app });
  const handed: Array<string> = [];
  const lines: Array<string> = [];
  const handoff = (step: string) => {
    handed.push(step);
    return Promise.resolve();
  };
  expect(
    await runAutoMerge(
      args,
      gh.run,
      { mode: 'on', step: 'bots' },
      (line) => lines.push(line),
      handoff,
    ),
  ).toBe(0);
  expect(handed).toEqual(['bots']);
  expect(lines).toEqual(['Would auto-merge at the step bots.\nHanded the merge to the merge job.']);
  expect([...merges(gh.calls), ...comments(gh.calls)]).toEqual([]);
});

test('the enabled marker keeps the form that clutch metrics reads', () => {
  // apps/cli/src/metrics/pulls.ts matches this form to count merges by step. Change both together.
  for (const step of ['bots', 'low', 'medium'] as const) {
    expect(enabledMarker(step, 'a1b2c3d4e5f6')).toMatch(
      /^<!-- automerge-enabled:(bots|low|medium):[0-9a-f]+ -->$/u,
    );
  }
});

test('no dry-run comment while a required check is still running', async () => {
  const running = fake([
    [
      'gh api --paginate repos/eggdev/clutch/commits/a1b2',
      {
        out: JSON.stringify({
          id: 1,
          name: 'validate',
          status: 'in_progress',
          conclusion: null,
          app: 'github-actions',
        }),
      },
    ],
  ]);
  const [line] = await decide(running, { mode: 'dry-run', step: 'low' });
  expect(line).toContain('- The required check validate is pending.');
  expect(line).toEndWith('No dry-run comment: Waiting for validate, agent-review to finish.');
  expect([...merges(running.calls), ...comments(running.calls)]).toEqual([]);
});

test('a same-named check from another app is no proof, so the Actions run decides', async () => {
  const spoofed = fake([
    [
      'gh api --paginate repos/eggdev/clutch/commits/a1b2',
      {
        out: [
          {
            id: 1,
            name: 'validate',
            status: 'completed',
            conclusion: 'failure',
            app: 'github-actions',
          },
          { id: 9, name: 'validate', status: 'completed', conclusion: 'success', app: 'other-app' },
          {
            id: 3,
            name: 'agent-review',
            status: 'completed',
            conclusion: 'success',
            app: 'github-actions',
          },
        ]
          .map((line) => JSON.stringify(line))
          .join('\n'),
      },
    ],
  ]);
  const [line] = await decide(spoofed, { mode: 'on', step: 'low' });
  expect(line).toContain('- The required check validate is failure.');
  expect(merges(spoofed.calls)).toEqual([]);
});
