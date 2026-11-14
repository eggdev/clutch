import { expect, test } from 'bun:test';

import { app, comments, decide, facts, fake, head, merges } from '@tools/github/auto-merge-fake';
import { blockers, dryRunComment, steps } from '@tools/github/auto-merge-rules';
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
      facts({ mainRed: ['validate'], weakerJourneys: ['It lowers a budget.'] }, reverting),
      'bots',
    ),
  ).toEqual(['A journey gets weaker, so the owner decides: It lowers a budget.']);
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

test('a named contract break holds a PR at any tier for the owner, and the owner approval lifts it', () => {
  const reason = 'The contract snapshot names the break Note.title. The owner agrees to a break.';
  for (const step of steps) {
    const broken = facts({
      tier: step === 'bots' ? 'one-way-door' : 'low',
      breaks: ['Note.title'],
    });
    expect(blockers(broken, step)).toContain(reason);
    expect(blockers({ ...broken, ownerApproved: true }, step)).toEqual([]);
  }
  expect(blockers(facts({ breaks: [] }), 'low')).toEqual([]);
  expect(
    dryRunComment(facts({ breaks: ['Note.title'], ownerApproved: true }), [], 'low'),
  ).toContain('- Contract breaks the owner agreed to: `Note.title`');
});

test('a major change holds a PR at any tier for the owner, and the owner approval lifts it', () => {
  const why = 'its title has "!" before the colon';
  const reason = `The change is major: ${why}. The owner signs off a major change.`;
  for (const step of steps) {
    const major = facts({ tier: step === 'bots' ? 'one-way-door' : 'low', major: [why] });
    expect(blockers(major, step)).toContain(reason);
    expect(blockers({ ...major, ownerApproved: true }, step)).toEqual([]);
  }
  expect(blockers(facts({ major: [] }), 'low')).toEqual([]);
  expect(dryRunComment(facts({ major: [why], ownerApproved: true }), [], 'low')).toContain(
    `- Major change the owner approved: ${why}`,
  );
});

test('a failed or running native journey holds, and a skipped one does not', () => {
  expect(blockers(facts({ native: { 'native-ios': 'skipped' } }), 'medium')).toEqual([]);
  expect(blockers(facts({ native: { 'native-ios': 'failure' } }), 'medium')).toEqual([
    'The native journey native-ios is failure.',
  ]);
});

/** The default branch holds the check scripts, and the PR changes `tools/check-scope.ts`. */
const changesCheck: Array<[string, Partial<Result>]> = [
  [
    'git show origin/main:tools/guardrail-files.json',
    { out: JSON.stringify({ patterns: ['tools/check-*.ts'], held: ['tools/check-*.ts'] }) },
  ],
  ['git merge-base', { out: 'b4se\n' }],
  ['git diff --name-status', { out: 'M\ttools/check-scope.ts\n' }],
];

/** CL-123, the issue of the PR's branch, with `files` under `## Files`. */
const issueWith = (...files: Array<string>) =>
  `# CL-123: Docs\n\n## Files\n\n${files.map((file) => `- \`${file}\``).join('\n')}\n\n## Verify\n`;

test('a changed check that the issue does not name holds, with both ways out', async () => {
  const gh = fake([
    ...changesCheck,
    ['git show origin/main:.clutch/issues/CL-123.md', { out: issueWith('docs/a.md') }],
  ]);
  const [verdict = ''] = await decide(gh, { mode: 'on', step: 'medium' });
  expect(verdict).toContain(
    "- The PR changes the guardrail file `tools/check-scope.ts`, which sets a check, a lint rule, a budget or a hook, and the `## Files` section of CL-123 on main does not name it. Take the change out of this PR, or first merge a change to CL-123 that names it under `## Files`, then merge main into this branch. The owner's approval also lifts this hold.",
  );
  expect(merges(gh.calls)).toEqual([]);
});

test('a changed check that the issue on the default branch names merges', async () => {
  const gh = fake([
    ...changesCheck,
    ['git show origin/main:.clutch/issues/CL-123.md', { out: issueWith('tools/check-scope.ts') }],
  ]);
  expect(await decide(gh, { mode: 'on', step: 'medium' })).toEqual([
    'Would auto-merge at the step medium.\nQueued the merge.',
  ]);
});

test('an issue file that only the pull request changes does not lift the hold', async () => {
  const gh = fake([
    changesCheck[0],
    changesCheck[1],
    ['git diff --name-status', { out: 'A\t.clutch/issues/CL-123.md\nM\ttools/check-scope.ts\n' }],
    [
      'git show origin/main:.clutch/issues/CL-123.md',
      { ok: false, err: 'fatal: path not in main' },
    ],
    [`git show ${head}:.clutch/issues/CL-123.md`, { out: issueWith('tools/check-scope.ts') }],
  ]);
  const [verdict = ''] = await decide(gh, { mode: 'on', step: 'medium' });
  expect(verdict).toContain('`tools/check-scope.ts`');
  expect(verdict).toContain('CL-123 is not on main.');
  expect(gh.calls.some((call) => call.startsWith(`git show ${head}:.clutch/issues`))).toBe(false);
  expect(merges(gh.calls)).toEqual([]);
});

test("the owner's approval lifts a guardrail hold", async () => {
  const gh = fake([
    ...changesCheck,
    ['gh api --paginate repos/eggdev/clutch/pulls/7/reviews', { out: `APPROVED\t${head}\n` }],
  ]);
  expect(await decide(gh, { mode: 'on', step: 'medium', owner: 'eggdev' })).toEqual([
    'Would auto-merge at the step medium. The owner approved this head.\nQueued the merge.',
  ]);
  const held = facts({ guardrails: ['The PR changes the guardrail file `tools/check-scope.ts`.'] });
  expect(blockers(held, 'medium')).toHaveLength(1);
  expect(blockers({ ...held, ownerApproved: true }, 'medium')).toEqual([]);
});

test('a revert that changes a check takes the bot path, with no guardrail hold', async () => {
  const gh = fake(
    [
      ...changesCheck,
      ['gh api --paginate repos/eggdev/clutch/issues/5/comments', { out: '901\n' }],
    ],
    { headRefName: 'revert/5', author: app },
  );
  expect(await decide(gh, { mode: 'on', step: 'medium' })).toEqual([
    'Would auto-merge at the step medium.\nQueued the merge.',
  ]);
  expect(gh.calls.some((call) => call.includes(':tools/guardrail-files.json'))).toBe(false);
});
