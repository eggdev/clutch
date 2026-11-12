import { expect, test } from 'bun:test';

import { ownerApproved } from '@tools/github/auto-merge';
import { decide, facts, fake, head, merges } from '@tools/github/auto-merge-fake';
import { blockers, verdictText } from '@tools/github/auto-merge-rules';
import type { Result } from '@tools/github/stack';

const reviews = 'gh api --paginate repos/eggdev/clutch/pulls/7/reviews';
const oneWayDoor: [string, { out: string }] = [
  'bun tools/clutch.ts risk',
  { out: '{"tier":"one-way-door"}' },
];

test("the owner's approval of the head lifts the tier and the owner findings, and nothing else", () => {
  const held = facts({
    tier: 'one-way-door',
    weakerJourneys: ['x.pw.ts: it no longer proves the outcome `paid`.'],
  });
  expect(blockers(held, 'medium')).toEqual([
    'The risk tier is one-way-door, not low or medium.',
    'A journey gets weaker, so the owner decides: x.pw.ts: it no longer proves the outcome `paid`.',
  ]);
  expect(blockers({ ...held, ownerApproved: true }, 'bots')).toEqual([]);
  expect(
    blockers(
      {
        ...held,
        ownerApproved: true,
        checks: { validate: 'pending', 'agent-review': 'success' },
        mainRed: ['validate'],
      },
      'medium',
    ),
  ).toEqual([
    'The required check validate is pending.',
    'The required check validate is red on main. Nothing merges until it is green.',
  ]);
  expect(blockers({ ...held, ownerApproved: true }, 'medium')).toEqual([]);
  expect(blockers(facts({ ownerApproved: true }, { isDraft: true }), 'medium')).toEqual([
    'The pull request is a draft.',
  ]);
  expect(verdictText([], 'medium', true)).toBe(
    'Would auto-merge at the step medium. The owner approved this head.',
  );
});

/** Whether the owner `eggdev` approved the head, when the reviews API answers `out`. */
const approved = (out: string) =>
  ownerApproved(fake([[reviews, { out }]]).run, 'eggdev/clutch', '7', head, 'eggdev');

test("only the owner's latest approving or change-asking review on the head counts", async () => {
  expect(await approved(`APPROVED\t${head}`)).toBe(true);
  expect(await approved('APPROVED\toldsha')).toBe(false);
  expect(await approved(`APPROVED\t${head}\nCHANGES_REQUESTED\t${head}`)).toBe(false);
  expect(await approved(`CHANGES_REQUESTED\t${head}\nAPPROVED\t${head}`)).toBe(true);
  expect(await approved('')).toBe(false);
  const noOwner = fake([[reviews, { out: `APPROVED\t${head}` }]]);
  expect(await ownerApproved(noOwner.run, 'eggdev/clutch', '7', head)).toBe(false);
  expect(noOwner.calls.filter((call) => call.startsWith(reviews))).toEqual([]);
});

test('on queues a one-way-door PR once the owner approved its head, and not before', async () => {
  const waiting = fake([oneWayDoor]);
  const [before] = await decide(waiting, { mode: 'on', step: 'medium', owner: 'eggdev' });
  expect(before).toContain('The risk tier is one-way-door, not low or medium.');
  expect(merges(waiting.calls)).toEqual([]);
  const afterApproval = fake([oneWayDoor, [reviews, { out: `APPROVED\t${head}` }]]);
  expect(await decide(afterApproval, { mode: 'on', step: 'medium', owner: 'eggdev' })).toEqual([
    'Would auto-merge at the step medium. The owner approved this head.\nQueued the merge.',
  ]);
  expect(merges(afterApproval.calls)).toEqual([
    `gh pr merge 7 --auto --merge --match-head-commit ${head}`,
  ]);
  expect(afterApproval.calls.find((call) => call.startsWith(reviews))).toContain(
    'select(.user.login == "eggdev"',
  );
});

test("the owner's approval never lifts the bot rule", () => {
  const renovate = facts(
    { ownerApproved: true, botProblems: ['tools/x.ts is not a dependency file.'] },
    { headRefName: 'renovate/all-minor', author: { login: 'app/renovate', is_bot: true } },
  );
  expect(blockers(renovate, 'medium')).toEqual(['tools/x.ts is not a dependency file.']);
});

const contract = 'gh api repos/eggdev/clutch/contents/contract.json';

/** The files of pull request 7, as `gh api repos/<repo>/pulls/7/files` lists them. */
const files = (...names: Array<string>): [string, Partial<Result>] => [
  'gh api --paginate repos/eggdev/clutch/pulls/7/files',
  { out: names.map((filename) => JSON.stringify({ filename, patch: '' })).join('\n') },
];

/** A snapshot of the head that names `breaks`. */
const snapshot = (breaks: unknown): [string, Partial<Result>] => [
  contract,
  { out: JSON.stringify({ breaks }) },
];

test('on holds a low-risk PR whose diff makes a contract break, until the owner approves its head', async () => {
  const config = { mode: 'on', step: 'medium', owner: 'eggdev' } as const;
  const waiting = fake([files('contract.json'), snapshot(['Note.title'])]);
  const [before] = await decide(waiting, config);
  expect(before).toContain(
    'The contract snapshot names the break Note.title. The owner agrees to a break.',
  );
  expect(merges(waiting.calls)).toEqual([]);
  expect(waiting.calls.filter((call) => call.includes('/pulls/7/files'))).toHaveLength(1);
  const approvedHead = fake([
    files('contract.json'),
    snapshot(['Note.title']),
    [reviews, { out: `APPROVED\t${head}` }],
  ]);
  expect(await decide(approvedHead, config)).toEqual([
    'Would auto-merge at the step medium. The owner approved this head.\nQueued the merge.',
  ]);
  const untouched = fake([files('docs/x.md'), snapshot(['Note.title'])]);
  expect(await decide(untouched, config)).toEqual([
    'Would auto-merge at the step medium.\nQueued the merge.',
  ]);
});
