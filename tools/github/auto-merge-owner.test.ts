import { expect, test } from 'bun:test';

import { contractBreaks, ownerApproved } from '@tools/github/auto-merge';
import { decide, facts, fake, head, merges } from '@tools/github/auto-merge-fake';
import { blockers, verdictText } from '@tools/github/auto-merge-rules';
import type { Result } from '@tools/github/stack';

const reviews = 'gh api --paginate repos/eggdev/clutch/pulls/7/reviews';
const oneWayDoor: [string, { out: string }] = [
  'bun tools/clutch.ts risk',
  { out: '{"tier":"one-way-door"}' },
];

test("the owner's approval of the head lifts the tier, and nothing else", () => {
  const held = facts({ tier: 'one-way-door', ownerFindings: ['It adds a migration.'] });
  expect(blockers(held, 'medium')).toEqual(['The risk tier is one-way-door, not low or medium.']);
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
  expect(verdictText([], 'medium', [], true)).toBe(
    'Would auto-merge at the step medium. The owner approved this head.',
  );
  expect(verdictText([], 'medium', held.ownerFindings, true)).toBe(
    'Would auto-merge at the step medium. The owner approved this head.\nOwner findings, recorded for the weekly digest:\n- It adds a migration.',
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

test('contractBreaks gives each name the snapshot of the head names under breaks', async () => {
  const two = fake([
    files('contract.json'),
    [contract, { out: JSON.stringify({ breaks: ['A.one', 'B.two'] }) }],
  ]);
  expect(await contractBreaks(two.run, 'eggdev/clutch', '7', head)).toEqual(['A.one', 'B.two']);
  expect(two.calls.find((call) => call.startsWith(contract))).toContain(`?ref=${head}`);
  const none = fake([files('contract.json'), [contract, { out: JSON.stringify({ breaks: [] }) }]]);
  expect(await contractBreaks(none.run, 'eggdev/clutch', '7', head)).toEqual([]);
});

test('contractBreaks has no breaks when the head has no contract snapshot', async () => {
  const missing = fake([
    files('contract.json'),
    [contract, { ok: false, err: 'gh: Not Found (HTTP 404)' }],
  ]);
  expect(await contractBreaks(missing.run, 'eggdev/clutch', '7', head)).toEqual([]);
});

test('contractBreaks refuses a snapshot whose breaks is not a list of strings', async () => {
  const bad = fake([
    files('contract.json'),
    [contract, { out: JSON.stringify({ breaks: 'Note.title' }) }],
  ]);
  await expect(contractBreaks(bad.run, 'eggdev/clutch', '7', head)).rejects.toThrow(
    `contract.json at ${head}: \`breaks\` is not a list of strings.`,
  );
  const mixed = fake([
    files('contract.json'),
    [contract, { out: JSON.stringify({ breaks: ['A', 1] }) }],
  ]);
  await expect(contractBreaks(mixed.run, 'eggdev/clutch', '7', head)).rejects.toThrow(
    `contract.json at ${head}`,
  );
});

test('a pull request that does not change contract.json has no breaks, also when the snapshot of its head names one', async () => {
  const gh = fake([
    files('bun.lock'),
    [contract, { out: JSON.stringify({ breaks: ['Note.title'] }) }],
  ]);
  expect(await contractBreaks(gh.run, 'eggdev/clutch', '7', head)).toEqual([]);
  expect(gh.calls.some((call) => call.startsWith(contract))).toBe(false);
});
