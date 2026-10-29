import { expect, test } from 'bun:test';

import { lint } from '@tools/testing/lint-imports';

const header = "import { describe, expect, it, test } from 'bun:test';\n\n";

test('a skipped, focused, todo or failing test fails, in every spelling', async () => {
  expect(
    await lint(
      {
        'packages/notes/ui/notes.test.ts': `${header}${[
          "test.skip('a', () => { expect(1).toBe(1); });",
          "test.only('b', () => { expect(1).toBe(1); });",
          "test.todo('c');",
          "it.skip('d', () => { expect(1).toBe(1); });",
          "describe.only('e', () => { test('f', () => { expect(1).toBe(1); }); });",
          "test.skip.each([1])('g', (n) => { expect(n).toBe(1); });",
          "test.if(false)('h', () => { expect(1).toBe(1); });",
          "test.failing('i', () => { expect(1).toBe(2); });",
          "xtest('j', () => { expect(1).toBe(1); });",
          "xit('k', () => { expect(1).toBe(1); });",
        ].join('\n')}\n`,
      },
      ['repo-tests'],
    ),
  ).toEqual(
    Array.from({ length: 10 }, () => 'packages/notes/ui/notes.test.ts repo-tests/no-hidden-tests'),
  );
});

test('a snapshot, a test with no assertion and an existence-only test fail', async () => {
  expect(
    await lint(
      {
        'packages/notes/ui/notes.test.ts': `${header}${[
          "test('a', () => { expect({ id: 1 }).toMatchSnapshot(); });",
          "test('b', () => { expect('x').toMatchInlineSnapshot(); });",
          "test('c', () => { const total = 1 + 1; });",
          "test('d', () => { expect(find()).toBeDefined(); expect(find()).not.toBeNull(); });",
          "test('e', () => { expect(() => run()).not.toThrow(); });",
          "test('f', () => { expect(ok()).toBeTruthy(); });",
        ].join('\n')}\n`,
      },
      ['repo-tests'],
    ),
  ).toEqual([
    'packages/notes/ui/notes.test.ts repo-tests/assert-behavior',
    'packages/notes/ui/notes.test.ts repo-tests/assert-behavior',
    'packages/notes/ui/notes.test.ts repo-tests/assert-behavior',
    'packages/notes/ui/notes.test.ts repo-tests/assert-behavior',
    'packages/notes/ui/notes.test.ts repo-tests/no-snapshots',
    'packages/notes/ui/notes.test.ts repo-tests/no-snapshots',
  ]);
});

test('a test that asserts a value, through expect or a named helper, passes', async () => {
  expect(
    await lint(
      {
        'packages/notes/ui/notes.test.ts': `${header}${[
          "test('a', () => { expect(rename('x')).toEqual({ title: 'x' }); });",
          "test('b', () => { expect(find()).toBeDefined(); expect(find()?.title).toBe('x'); });",
          "test('c', async () => { await expectRejected(run(), 'not_member'); });",
          "test.each([1, 2])('d %d', (n) => { expect(double(n)).toBe(n * 2); });",
          "describe('e', () => { test('f', () => { expect(1 + 1).toBe(2); }); });",
        ].join('\n')}\n`,
        'packages/notes/ui/notes.ts': 'export const skip = { only: () => 1 };\nskip.only();\n',
      },
      ['repo-tests'],
    ),
  ).toEqual([]);
});
