import { expect, test } from 'bun:test';

import { ownerApproved } from '@tools/github/auto-merge';
import { decide, facts, fake, head, merges } from '@tools/github/auto-merge-fake';
import { blockers, verdictText } from '@tools/github/auto-merge-rules';

const reviews = 'gh api --paginate repos/eggdev/clutch/pulls/7/reviews';
const oneWayDoor: [string, { out: string }] = [
  'bun tools/clutch.ts risk',
  { out: '{"tier":"one-way-door"}' },
];

test("the owner's approval of the head lifts the tier and the owner findings, and nothing else", () => {
  const held = facts({ tier: 'one-way-door', ownerFindings: ['It adds a migration.'] });
  expect(blockers(held, 'medium')).toEqual([
    'The risk tier is one-way-door, not low or medium.',
    'Agent review asks the owner: It adds a migration.',
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
  expect(verdictText([], 'medium', [], true)).toBe(
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
