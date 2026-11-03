import { expect, test } from 'bun:test';

import { app, decide, facts, fake, head, merges } from '@tools/github/auto-merge-fake';
import { blockers, upstreamFindings, verdictText } from '@tools/github/auto-merge-rules';
import type { Result } from '@tools/github/stack';

/** The owner findings of a pure Clutch sync: the release bot's sync PR, with one owner finding from agent review. */

const sync = { headRefName: 'clutch-sync/latest', author: app };
const finding = 'It lowers the file-size budget of a.ts.';

const ownerFindingAnswers: Array<[string, Partial<Result>]> = [
  [
    `gh api repos/eggdev/clutch/commits/${head}/check-runs?check_name=agent-review`,
    { out: '3\n9\n' },
  ],
  ['gh api repos/eggdev/clutch/check-runs/9/annotations', { out: `${finding}\n` }],
];

const checkRun = (name: string, conclusion: string, id: number) =>
  JSON.stringify({ id, name, status: 'completed', conclusion, app: 'github-actions' });

/** The check runs of the head. `doctor` is the `clutch / doctor` run's conclusion, or null when the run is absent. */
const headChecks = (doctor: string | null, validate: string) =>
  [
    checkRun('validate', validate, 1),
    checkRun('agent-review', 'success', 2),
    ...(doctor === null ? [] : [checkRun('clutch / doctor', doctor, 3)]),
  ].join('\n');

const headRuns = (doctor: string | null, validate = 'success'): [string, Partial<Result>] => [
  `gh api --paginate repos/eggdev/clutch/commits/${head}/check-runs`,
  { out: headChecks(doctor, validate) },
];

/** The lineage at the head: a sync PR's managed files, none of which the pure sync fixtures change. */
const lineage: [string, Partial<Result>] = ['git show', { out: '{"files":{}}' }];

const syncFiles = (
  files: Array<{ filename: string; patch: string }>,
): [string, Partial<Result>] => [
  'gh api --paginate repos/eggdev/clutch/pulls/7/files',
  { out: files.map((file) => JSON.stringify(file)).join('\n') },
];

test('a pure Clutch sync with doctor success merges past its owner finding, and the verdict lists it', async () => {
  const gh = fake([...ownerFindingAnswers, headRuns('success'), lineage], sync);
  expect(await decide(gh, { mode: 'on', step: 'bots' })).toEqual([
    `Would auto-merge at the step bots.\nOwner findings, approved upstream in Clutch:\n- ${finding}\nQueued the merge.`,
  ]);
  expect(merges(gh.calls)).toEqual([`gh pr merge 7 --auto --merge --match-head-commit ${head}`]);
});

test('a pure sync whose doctor check is missing or failed keeps its owner finding', async () => {
  for (const doctor of [null, 'failure']) {
    const gh = fake([...ownerFindingAnswers, headRuns(doctor), lineage], sync);
    expect(await decide(gh, { mode: 'on', step: 'bots' })).toEqual([
      `Would not auto-merge at the step bots:\n- Agent review asks the owner: ${finding}`,
    ]);
    expect(merges(gh.calls)).toEqual([]);
  }
});

test('a sync with a file that clutch sync does not write keeps its owner finding, doctor or not', async () => {
  const gh = fake(
    [
      ...ownerFindingAnswers,
      headRuns('success'),
      lineage,
      syncFiles([{ filename: 'apps/web/src/main.ts', patch: '+evil' }]),
    ],
    sync,
  );
  expect(await decide(gh, { mode: 'on', step: 'bots' })).toEqual([
    `Would not auto-merge at the step bots:\n- apps/web/src/main.ts is not a file that clutch sync writes.\n- Agent review asks the owner: ${finding}`,
  ]);
  expect(merges(gh.calls)).toEqual([]);
});

test('a failed required check holds a pure sync, and its owner finding still shows as approved upstream', async () => {
  const gh = fake([...ownerFindingAnswers, headRuns('success', 'failure'), lineage], sync);
  expect(await decide(gh, { mode: 'on', step: 'bots' })).toEqual([
    `Would not auto-merge at the step bots:\n- The required check validate is failure.\nOwner findings, approved upstream in Clutch:\n- ${finding}`,
  ]);
  expect(merges(gh.calls)).toEqual([]);
});

test('an agent PR keeps its owner finding at every step, even with a doctor success', async () => {
  for (const step of ['low', 'medium'] as const) {
    const gh = fake([...ownerFindingAnswers, headRuns('success')]);
    const [line] = await decide(gh, { mode: 'on', step });
    expect(merges(gh.calls)).toEqual([]);
    expect(line).toContain(`- Agent review asks the owner: ${finding}`);
    expect(line).not.toContain('approved upstream');
  }
});

test('the rule takes a finding only from a pure sync whose doctor succeeded, and says so in the verdict', () => {
  const pure = facts({ doctor: 'success', ownerFindings: [finding] }, sync);
  expect(blockers(pure, 'bots')).toEqual([]);
  expect(upstreamFindings(pure)).toEqual([finding]);
  expect(verdictText(blockers(pure, 'bots'), 'bots', upstreamFindings(pure))).toBe(
    `Would auto-merge at the step bots.\nOwner findings, approved upstream in Clutch:\n- ${finding}`,
  );
  const held = `Agent review asks the owner: ${finding}`;
  expect(blockers(facts({ doctor: 'pending', ownerFindings: [finding] }, sync), 'bots')).toEqual([
    held,
  ]);
  expect(blockers(facts({ doctor: 'missing', ownerFindings: [finding] }, sync), 'bots')).toEqual([
    held,
  ]);
  expect(
    blockers(
      facts({ doctor: 'success', ownerFindings: [finding], botProblems: ['x'] }, sync),
      'bots',
    ),
  ).toEqual(['x', held]);
  expect(
    blockers(
      facts(
        { doctor: 'success', ownerFindings: [finding] },
        { ...sync, author: { login: 'eggdev', is_bot: false } },
      ),
      'bots',
    ),
  ).toEqual(['The author of the clutch-sync branch is not a bot.', held]);
  expect(
    blockers(
      facts(
        { doctor: 'success', ownerFindings: [finding] },
        { headRefName: 'renovate/x', author: app },
      ),
      'bots',
    ),
  ).toEqual([held]);
  expect(blockers(facts({ doctor: 'success', ownerFindings: [finding] }), 'medium')).toEqual([
    held,
  ]);
  expect(upstreamFindings(facts({ doctor: 'success', ownerFindings: [finding] }))).toEqual([]);
});
