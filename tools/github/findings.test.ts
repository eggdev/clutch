import { expect, test } from 'bun:test';

import { fake, fakeClock, noWrite, trunk } from '@tools/github/fake-run';
import {
  dispositionHeading,
  findingsOf,
  latestDisposition,
  levelOf,
  prFindings,
  renderFindings,
  unanswered,
} from '@tools/github/findings';
import type { Inline } from '@tools/github/findings';
import { runPr } from '@tools/github/pr';

const inline: Array<Inline> = [
  {
    id: 1,
    path: 'docs/a.md',
    line: 3,
    commit: 'old1111',
    body: '**blocking** — docs did not move. Add the page.',
  },
  {
    id: 2,
    path: 'tools/x.ts',
    line: 9,
    commit: 'old1111',
    body: 'owner: a new escape hatch. The owner decides.',
  },
  {
    id: 3,
    path: 'tools/x.ts',
    line: 10,
    commit: 'h3ad000',
    body: '**owner** (rule: weaker). Still a hatch.',
  },
  {
    id: 4,
    path: 'ci.yml',
    line: 1,
    commit: 'h3ad000',
    body: 'note — changed guardrail file. Stronger.',
  },
  { id: 5, path: 'ci.yml', line: 1, commit: 'h3ad000', body: 'Thanks, fixed.' },
];

test('levelOf reads the level that each review comment style starts with', () => {
  expect(levelOf('**blocking** — x')).toBe('blocking');
  expect(levelOf('owner: x')).toBe('owner');
  expect(levelOf('  note. Rule: x')).toBe('note');
  expect(levelOf('Thanks, fixed.')).toBeNull();
});

test('findings group by file and level, across heads, and keep earlier heads', () => {
  const found = findingsOf(inline, 'h3ad000', '');
  expect(found.map((item) => [item.level, item.path, item.ids, item.current])).toEqual([
    ['blocking', 'docs/a.md', [1], false],
    ['owner', 'tools/x.ts', [2, 3], true],
    ['note', 'ci.yml', [4], true],
  ]);
  expect(found[0]?.summary).toBe('docs did not move.');
  expect(unanswered(found)).toHaveLength(3);
});

test('a disposition line answers a finding by its id, or by its path and level', () => {
  const disposition = latestDisposition([
    `${dispositionHeading}\n\n- blocking docs/a.md: an old answer`,
    'an unrelated comment',
    `${dispositionHeading}\n\n- blocking \`docs/a.md\`: fixed in abc1234\n- (2, 3): waits for the owner: approve the hatch\n- note ci.yml mentioned without its level`,
  ]);
  const found = findingsOf(inline, 'h3ad000', disposition);
  expect(found.map((item) => item.disposition)).toEqual([
    '- blocking `docs/a.md`: fixed in abc1234',
    '- (2, 3): waits for the owner: approve the hatch',
    '- note ci.yml mentioned without its level',
  ]);
  expect(
    findingsOf(inline, 'h3ad000', `${dispositionHeading}\n- ci.yml: ok`)[2]?.disposition,
  ).toBeNull();
});

test('the report names each finding, and gives a template for the unanswered ones', () => {
  const text = renderFindings(findingsOf(inline, 'h3ad000', ''));
  expect(text).toContain('- blocking docs/a.md (only on old1111; ids 1): docs did not move.');
  expect(text).toContain('NO DISPOSITION');
  expect(text).toContain('3 finding(s) have no disposition.');
  expect(text).toContain('- owner `tools/x.ts` (2, 3): fixed in <sha>');
  expect(renderFindings([])).toBe('Agent review left no finding on this PR.');
});

/** `gh` for PR 17 with the inline comments above and `notes` as its PR comments. */
function prWith(notes: Array<string>) {
  return fake([
    trunk,
    ['gh pr view 17 --json headRefOid', { out: 'h3ad000\n' }],
    [
      'gh api --paginate repos/{owner}/{repo}/pulls/17/comments',
      { out: inline.map((item) => JSON.stringify(item)).join('\n') },
    ],
    [
      'gh api --paginate repos/{owner}/{repo}/issues/17/comments',
      { out: notes.map((note) => JSON.stringify(note)).join('\n') },
    ],
  ]);
}

test('pr findings --check fails until each finding has a disposition', async () => {
  expect(await prFindings(prWith([]).run, '17')).toHaveLength(3);
  expect(await runPr(['findings', '17', '--check'], prWith([]).run, noWrite, fakeClock())).toBe(1);
  const answered = `${dispositionHeading}\n- 1: fixed in abc\n- 2: owner\n- 4: no action, it says the check got stronger`;
  expect(
    await runPr(['findings', '17', '--check'], prWith([answered]).run, noWrite, fakeClock()),
  ).toBe(0);
  expect(await runPr(['findings', '17'], prWith([]).run, noWrite, fakeClock())).toBe(0);
});

test('merge refuses a PR with a finding that has no disposition, and names the command', async () => {
  const gh = fake([
    trunk,
    [
      'gh pr view 17 --json baseRefName',
      {
        out: JSON.stringify({
          baseRefName: 'main',
          headRefName: 'cl-1',
          headRefOid: 'h3ad000',
          reviewDecision: '',
          mergeStateStatus: 'CLEAN',
          reviewRequests: [],
          latestReviews: [],
        }),
      },
    ],
    ['gh pr view 17 --json headRefOid', { out: 'h3ad000\n' }],
    [
      'gh api --paginate repos/{owner}/{repo}/pulls/17/comments',
      { out: inline.map((item) => JSON.stringify(item)).join('\n') },
    ],
  ]);
  const refusal = runPr(['merge', '17'], gh.run, noWrite, fakeClock());
  await expect(refusal).rejects.toThrow('#17 has 3 agent review finding(s) with no disposition');
  await expect(runPr(['merge', '17'], gh.run, noWrite, fakeClock())).rejects.toThrow(
    'bun run pr findings 17',
  );
  expect(gh.calls.some((call) => call.startsWith('gh pr merge'))).toBe(false);
});
