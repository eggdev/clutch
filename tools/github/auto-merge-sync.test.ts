import { expect, test } from 'bun:test';

import { app, decide, facts, fake, head, merges } from '@tools/github/auto-merge-fake';
import { blockers, verdictText } from '@tools/github/auto-merge-rules';
import type { Result } from '@tools/github/stack';

/**
 * Agent review's owner findings hold no pull request: the verdict records them
 * for the weekly digest. A Clutch sync PR and an agent PR are judged the same.
 */

const sync = { headRefName: 'clutch-sync/latest', author: app };
const finding = 'It lowers the file-size budget of a.ts.';
const recorded = `Owner findings, recorded for the weekly digest:\n- ${finding}`;

const ownerFindingAnswers: Array<[string, Partial<Result>]> = [
  [
    `gh api repos/eggdev/clutch/commits/${head}/check-runs?check_name=agent-review`,
    { out: '3\n9\n' },
  ],
  ['gh api repos/eggdev/clutch/check-runs/9/annotations', { out: `${finding}\n` }],
];

const checkRun = (name: string, conclusion: string, id: number) =>
  JSON.stringify({ id, name, status: 'completed', conclusion, app: 'github-actions' });

const headRuns = (validate = 'success'): [string, Partial<Result>] => [
  `gh api --paginate repos/eggdev/clutch/commits/${head}/check-runs`,
  { out: [checkRun('validate', validate, 1), checkRun('agent-review', 'success', 2)].join('\n') },
];

/** The lineage at the head: a sync PR's managed files, none of which the sync fixtures change. */
const lineage: [string, Partial<Result>] = ['git show', { out: '{"files":{}}' }];

const syncFiles = (
  files: Array<{ filename: string; patch: string }>,
): [string, Partial<Result>] => [
  'gh api --paginate repos/eggdev/clutch/pulls/7/files',
  { out: files.map((file) => JSON.stringify(file)).join('\n') },
];

test('a Clutch sync merges past its owner finding, and the verdict records it for the digest', async () => {
  const gh = fake([...ownerFindingAnswers, headRuns(), lineage], sync);
  expect(await decide(gh, { mode: 'on', step: 'bots' })).toEqual([
    `Would auto-merge at the step bots.\n${recorded}\nQueued the merge.`,
  ]);
  expect(merges(gh.calls)).toEqual([`gh pr merge 7 --auto --merge --match-head-commit ${head}`]);
});

test('a sync with a file that clutch sync does not write is held by that file, not by its owner finding', async () => {
  const gh = fake(
    [
      ...ownerFindingAnswers,
      headRuns(),
      lineage,
      syncFiles([{ filename: 'apps/web/src/main.ts', patch: '+evil' }]),
    ],
    sync,
  );
  expect(await decide(gh, { mode: 'on', step: 'bots' })).toEqual([
    `Would not auto-merge at the step bots:\n- apps/web/src/main.ts is not a file that clutch sync writes.\n${recorded}`,
  ]);
  expect(merges(gh.calls)).toEqual([]);
});

test('a failed required check holds a sync, and its owner finding still shows as recorded', async () => {
  const gh = fake([...ownerFindingAnswers, headRuns('failure'), lineage], sync);
  expect(await decide(gh, { mode: 'on', step: 'bots' })).toEqual([
    `Would not auto-merge at the step bots:\n- The required check validate is failure.\n${recorded}`,
  ]);
  expect(merges(gh.calls)).toEqual([]);
});

test('a green medium-risk agent PR merges past its owner finding at the step medium, and the verdict records it', async () => {
  const gh = fake([
    ...ownerFindingAnswers,
    headRuns(),
    ['bun tools/clutch.ts risk', { out: '{"tier":"medium"}' }],
  ]);
  expect(await decide(gh, { mode: 'on', step: 'medium' })).toEqual([
    `Would auto-merge at the step medium.\n${recorded}\nQueued the merge.`,
  ]);
  expect(merges(gh.calls)).toEqual([`gh pr merge 7 --auto --merge --match-head-commit ${head}`]);
});

test('an owner finding adds no reason, and the verdict lists every finding after the reasons', () => {
  const flagged = facts({ tier: 'medium', ownerFindings: [finding, 'It adds a migration.'] });
  expect(blockers(flagged, 'medium')).toEqual([]);
  expect(verdictText(blockers(flagged, 'medium'), 'medium', flagged.ownerFindings)).toBe(
    `Would auto-merge at the step medium.\n${recorded}\n- It adds a migration.`,
  );
  expect(blockers(flagged, 'low')).toEqual(['The risk tier is medium, not low.']);
  expect(verdictText(['The pull request is a draft.'], 'low', [finding])).toBe(
    `Would not auto-merge at the step low:\n- The pull request is a draft.\n${recorded}`,
  );
  expect(verdictText([], 'low', [])).toBe('Would auto-merge at the step low.');
  expect(blockers(facts({ ownerFindings: [finding] }, sync), 'bots')).toEqual([]);
  expect(
    blockers(
      facts({ ownerFindings: [finding] }, { ...sync, author: { login: 'eggdev', is_bot: false } }),
      'bots',
    ),
  ).toEqual(['The author of the clutch-sync branch is not a bot.']);
});

test('a major change and a contract break still hold a PR that also has owner findings', () => {
  const major = facts({
    tier: 'medium',
    ownerFindings: [finding],
    major: ['its title has "!" before the colon'],
  });
  expect(blockers(major, 'medium')).toEqual([
    'The change is major: its title has "!" before the colon. The owner signs off a major change.',
  ]);
  const broken = facts({ tier: 'medium', ownerFindings: [finding], breaks: ['Note.title'] });
  expect(blockers(broken, 'medium')).toEqual([
    'The contract snapshot names the break Note.title. The owner agrees to a break.',
  ]);
  expect(blockers({ ...major, ownerApproved: true }, 'medium')).toEqual([]);
  expect(blockers({ ...broken, ownerApproved: true }, 'medium')).toEqual([]);
});
