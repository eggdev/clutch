import { expect, test } from 'bun:test';

import { budgetError, parseArgs } from '@tools/test-budget';

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
