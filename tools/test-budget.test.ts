import { expect, test } from 'bun:test';

import { budgetError, parseArgs, withQuarantine } from '@tools/test-budget';

test('the budget passes at the limit and fails past it with a fix hint', () => {
  expect(budgetError(60_000, 60)).toBeNull();
  expect(budgetError(61_500, 60)).toStartWith('The tests took 61.5s. The budget is 60s.');
  expect(budgetError(61_500, 60)).toContain('Never delete or skip a test');
});

test('the arguments need a positive budget, a separator and a command', () => {
  expect(parseArgs(['60', '--', 'bun', 'test'])).toEqual({
    budgetSeconds: 60,
    command: ['bun', 'test'],
  });
  expect(() => parseArgs(['0', '--', 'bun'])).toThrow('Usage');
  expect(() => parseArgs(['60', 'bun', 'test'])).toThrow('Usage');
  expect(() => parseArgs(['60', '--'])).toThrow('Usage');
});

test('a bun test run leaves out the quarantined tests, and any other command is unchanged', () => {
  const flaky = [
    {
      file: 'tools/a.test.ts',
      name: 'slow one',
      issue: 'CL-128',
      until: '2026-11-20',
      reason: 'x',
    },
  ];
  expect(withQuarantine(['bun', 'test', 'tools'], flaky)).toEqual([
    'bun',
    'test',
    'tools',
    '--test-name-pattern',
    '^(?!(?:.* )?(?:slow one)$)',
  ]);
  expect(withQuarantine(['bun', 'test', 'tools'], [])).toEqual(['bun', 'test', 'tools']);
  expect(withQuarantine(['python3', 'tools/run-skill-tests.py'], flaky)).toEqual([
    'python3',
    'tools/run-skill-tests.py',
  ]);
});
