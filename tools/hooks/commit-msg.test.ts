import { expect, test } from 'bun:test';

import { conventionalProblem } from '@tools/hooks/commit-msg';

test('a conventional header passes, with or without a scope or a breaking mark', () => {
  for (const message of [
    'feat: add clutch init',
    'fix(cli): keep the project value on a package.json clash',
    'feat(sync)!: drop the template.commit pin',
    'docs: explain the minimum release age\n\nThe units differ by package manager.',
    '# a comment line\nchore: update the tracker',
  ]) {
    expect(conventionalProblem(message)).toBeUndefined();
  }
});

test("git's own merge, revert, fixup and squash messages pass", () => {
  for (const message of [
    'Merge pull request #36 from eggdev/clutch/cl-030',
    'Revert "feat: add clutch init"',
    'fixup! fix: keep the value',
    'squash! docs: explain it',
  ]) {
    expect(conventionalProblem(message)).toBeUndefined();
  }
});

test('a plain sentence, an unknown type and a long header are refused with the fix', () => {
  expect(conventionalProblem('Add the issues command')).toContain('is not a conventional commit');
  expect(conventionalProblem('feature: add it')).toContain('is not a conventional commit');
  expect(conventionalProblem('fix:no space')).toContain('is not a conventional commit');
  expect(conventionalProblem(`feat: ${'x'.repeat(80)}`)).toBe(
    'The first line has 86 characters. Keep it to 72.',
  );
});
