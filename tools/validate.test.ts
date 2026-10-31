import { expect, test } from 'bun:test';

import { changedPlan, checkTargets, runManyArgs, validateTargets } from '@tools/validate';

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

test('validate --changed runs everything without a base, and nothing for no change', () => {
  expect(changedPlan(null, null)).toEqual({ kind: 'full', steps: [runManyArgs(validateTargets)] });
  expect(changedPlan('abc', null).kind).toBe('full');
  expect(changedPlan('abc', [])).toEqual({ kind: 'none', steps: [] });
});

test('validate --changed runs only the root checks for a docs-only change', () => {
  expect(changedPlan('abc', ['docs/a.md', 'README.md', 'LICENSE'])).toEqual({
    kind: 'docs',
    steps: [runManyArgs(['checks'])],
  });
});

test('validate --changed runs the affected projects, then the root checks', () => {
  const plan = changedPlan('abc', ['apps/cli/src/main.ts', 'docs/a.md']);
  expect(plan.kind).toBe('affected');
  const [affected, checks] = plan.steps;
  expect(affected.slice(0, 3)).toEqual([
    'affected',
    '--base=abc',
    '--outputStyle=static-failures-only',
  ]);
  expect(affected).not.toContain('checks');
  // Every other validate target runs on the affected projects.
  expect(affected.slice(4)).toEqual(validateTargets.filter((target) => target !== 'checks'));
  expect(checks).toEqual(runManyArgs(['checks']));
});
