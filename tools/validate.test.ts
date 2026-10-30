import { expect, test } from 'bun:test';

import { checkTargets, runManyArgs, validateTargets } from '@tools/validate';

test('each run prints failing tasks in full', () => {
  expect(runManyArgs(['lint'])).toEqual([
    'run-many',
    '--outputStyle=static-failures-only',
    '-t',
    'lint',
  ]);
});

test('check runs a subset of validate', () => {
  expect(checkTargets.every((target) => validateTargets.includes(target))).toBe(true);
  expect(validateTargets).toContain('checks');
});
