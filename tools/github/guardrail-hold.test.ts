import { expect, test } from 'bun:test';

import { fake } from '@tools/github/fake-run';
import { guardrailHolds, issueFiles, weakerList } from '@tools/github/guardrail-hold';
import type { Result } from '@tools/github/stack';

const list = { patterns: ['tools/check-*.ts', 'tools/lint/**'], held: ['tools/check-*.ts'] };
const onMain: [string, Partial<Result>] = [
  'git show origin/main:tools/guardrail-files.json',
  { out: JSON.stringify(list) },
];
const diff = (lines: string): Array<[string, Partial<Result>]> => [
  ['git merge-base', { out: 'b4se\n' }],
  ['git diff --name-status', { out: lines }],
];
const missingIssue: [string, Partial<Result>] = [
  'git show origin/main:.clutch/issues/',
  { ok: false, err: "fatal: path '.clutch/issues/CL-123.md' does not exist in 'origin/main'" },
];

test('issueFiles reads each path in backticks of the Files section, and no other section', () => {
  const text =
    '## Steps\n\n- `tools/a.ts`\n\n## Files\n\n- `tools/check-scope.ts`, `x.md`\n- prose\n\n## Verify\n\n- `y`\n';
  expect([...issueFiles(text)]).toEqual(['tools/check-scope.ts', 'x.md']);
  expect([...issueFiles('## Files\n\n- `last.ts`\n')]).toEqual(['last.ts']);
  expect([...issueFiles('# No files\n')]).toEqual([]);
});

test('a list that drops a pattern or a held pattern, or exempts a new file, is weaker', () => {
  expect(weakerList(list, { ...list, patterns: [...list.patterns, 'new.json'] })).toBe(false);
  expect(weakerList(list, { ...list, exempt: {} })).toBe(false);
  expect(weakerList({ ...list, exempt: { 'a.md': 'why' } }, list)).toBe(false);
  expect(weakerList(list, { ...list, patterns: ['tools/check-*.ts'] })).toBe(true);
  expect(weakerList(list, { ...list, held: [] })).toBe(true);
  expect(weakerList(list, { ...list, exempt: { 'tools/check-x.ts': 'why' } })).toBe(true);
});

test('a held file that the branch has no issue for holds, and the reason names both ways out', async () => {
  const gh = fake([onMain, ...diff('M\ttools/check-scope.ts\n')]);
  expect(await guardrailHolds(gh.run, 'main', 'h3ad')).toEqual([
    "The PR changes the guardrail file `tools/check-scope.ts`, which sets a check, a lint rule, a budget or a hook, and the branch names no issue. Take the change out of this PR, or deliver the change on the branch of an issue on main whose `## Files` section names it. The owner's approval also lifts this hold.",
  ]);
});

test('an issue that is not on the default branch does not lift the hold', async () => {
  const gh = fake([
    onMain,
    ...diff('M\ttools/check-scope.ts\nM\ttools/check-base.ts\n'),
    missingIssue,
  ]);
  const [reason] = await guardrailHolds(gh.run, 'main', 'h3ad', 'CL-123');
  expect(reason).toContain('`tools/check-scope.ts`, `tools/check-base.ts`');
  expect(reason).toContain('CL-123 is not on main.');
  expect(reason).toContain('first merge a change to CL-123 that names them under `## Files`');
  expect(gh.calls.some((call) => call.includes('h3ad:.clutch/issues'))).toBe(false);
});

test('a new file, a test file and a file outside the held set do not hold', async () => {
  const lines = 'A\ttools/check-new.ts\nM\ttools/check-scope.test.ts\nM\ttools/lint/a.mjs\n';
  expect(await guardrailHolds(fake([onMain, ...diff(lines)]).run, 'main', 'h3ad')).toEqual([]);
});

test('a deleted or renamed held file holds by its old path', async () => {
  const lines = 'D\ttools/check-scope.ts\nR090\ttools/check-base.ts\tdocs/base.ts\n';
  const [reason] = await guardrailHolds(fake([onMain, ...diff(lines)]).run, 'main', 'h3ad');
  expect(reason).toContain('`tools/check-scope.ts`, `tools/check-base.ts`');
});

test('a change to the list holds only when it makes the list weaker', async () => {
  const held = { ...list, held: [...list.held, 'tools/guardrail-files.json'] };
  const file = 'tools/guardrail-files.json';
  const run = (head: object) =>
    fake([
      ['git show origin/main:tools/guardrail-files.json', { out: JSON.stringify(held) }],
      ...diff(`M\t${file}\n`),
      [`git show b4se:${file}`, { out: JSON.stringify(held) }],
      [`git show h3ad:${file}`, { out: JSON.stringify(head) }],
    ]).run;
  const stronger = { ...held, patterns: [...held.patterns, 'knip.jsonc'] };
  expect(await guardrailHolds(run(stronger), 'main', 'h3ad')).toEqual([]);
  const [reason] = await guardrailHolds(run({ ...held, held: [] }), 'main', 'h3ad');
  expect(reason).toContain(`\`${file}\``);
});

test('a default branch with no held set holds nothing, and reads no diff', async () => {
  const gh = fake([['git show origin/main:tools/guardrail-files.json', { ok: false }]]);
  expect(await guardrailHolds(gh.run, 'main', 'h3ad', 'CL-123')).toEqual([]);
  expect(gh.calls).toEqual(['git show origin/main:tools/guardrail-files.json']);
});
