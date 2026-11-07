import { expect, test } from 'bun:test';

import {
  budgetsOf,
  checkClickBudget,
  coreOf,
  kindOf,
  layoutShift,
  layoutShiftProblem,
  markFailure,
} from '@repo/journeys/testing/measure';
import type { Measure, Shift } from '@repo/journeys/testing/measure';

const shift = (value: number, at: number, elements: Array<string>, doc = 'a'): Shift => ({
  value,
  at,
  doc,
  page: '/sign-up',
  elements,
});

const measure = (
  core: string | null,
  steps: Array<[string, number]>,
  shifts: Array<Shift> = [],
): Measure => ({
  journey: 'sign-up',
  file: 'features/account/journeys/sign-up.pw.ts',
  core,
  platform: 'web',
  device: 'Phone',
  retry: 0,
  budgets: budgetsOf(),
  startedAt: 0,
  shifts,
  clicks: 0,
  keys: 0,
  steps: steps.at(-1)?.[1] ?? 0,
  outcomes: steps.map(([name, count]) => ({
    name,
    expected: {},
    elapsedMs: 0,
    clicks: count,
    keys: 0,
    steps: count,
  })),
  axe: [],
  failure: null,
  clickBudget: null,
});

test('the layout shift is the largest session window, and names its elements, largest share first', () => {
  const shifts = [
    shift(0.004, 100, ['p "Loading"']),
    shift(0.009, 600, ['form#sign-up', 'p "Loading"']),
    // A gap of more than 1 s starts a new window.
    shift(0.006, 2000, ['img']),
    // Another document is another page load.
    shift(0.008, 50, ['h1'], 'b'),
  ];
  expect(layoutShift(shifts)).toEqual({
    value: 0.004 + 0.009,
    page: '/sign-up',
    elements: ['p "Loading"', 'form#sign-up'],
  });
  expect(layoutShift([])).toEqual({ value: 0, page: null, elements: [] });
});

test('a window ends 5 s after it starts, even with no gap', () => {
  const shifts = Array.from({ length: 12 }, (_, index) => shift(0.002, index * 900, ['div']));
  expect(layoutShift(shifts).value).toBeCloseTo(0.012, 10);
});

test('a layout shift at the budget fails and names the shifted element, and one under it passes', () => {
  const over = measure(null, [], [shift(0.01, 0, ['div[data-testid="banner"] "Welcome"'])]);
  expect(layoutShiftProblem(over)).toBe(
    'The layout shift on /sign-up is 0.01, at or over the budget of 0.01 in `budgets.layoutShift` of clutch.yaml. It moved div[data-testid="banner"] "Welcome". Reserve the space of content that loads late. See docs/contributing/end-to-end-testing.md#budgets.',
  );
  expect(layoutShiftProblem(measure(null, [], [shift(0.009, 0, ['div'])]))).toBeNull();
});

test('the layout shift is compared before it is rounded', () => {
  // 0.00996 shows as 0.01, but it is under the budget, so it passes.
  const under = measure(null, [], [shift(0.00996, 0, ['div'])]);
  expect(layoutShift(under.shifts).value).toBe(0.00996);
  expect(layoutShiftProblem(under)).toBeNull();
  // 0.010004 shows as 0.01, and it is over the budget, so it fails.
  expect(layoutShiftProblem(measure(null, [], [shift(0.010004, 0, ['div'])]))).toContain(
    'is 0.01, at or over the budget of 0.01',
  );
});

test('a sign-up with 4 clicks fails its budget of 3 and records the kind, and one with 3 passes', () => {
  const over = measure('sign-up', [['signed-up', 4]]);
  expect(() => checkClickBudget(over, 'signed-up')).toThrow(
    'sign-up took 4 clicks or taps from the entry to `signed-up`, over its budget of 3',
  );
  expect(over.failure?.kind).toBe('click-budget');
  const fits = measure('sign-up', [['signed-up', 3]]);
  checkClickBudget(fits, 'signed-up');
  expect(fits.clickBudget).toEqual({
    budget: 3,
    used: 3,
    from: 'the entry',
    to: 'signed-up',
  });
});

test('another core journey counts its budget from signed-up, and a journey with no budget counts nothing', () => {
  const signIn = measure('sign-in', [
    ['signed-up', 3],
    ['signed-out', 4],
    ['signed-in', 7],
  ]);
  signIn.budgets = budgetsOf(JSON.stringify({ clicks: { 'sign-in': 3 } }));
  expect(() => checkClickBudget(signIn, 'signed-in')).toThrow(
    'sign-in took 4 clicks or taps from `signed-up` to `signed-in`, over its budget of 3',
  );
  const noBudget = measure('onboarding', [['onboarded', 9]]);
  checkClickBudget(noBudget, 'onboarded');
  expect(noBudget.clickBudget).toBeNull();
});

test('the budgets of clutch.yaml go over the template defaults', () => {
  expect(budgetsOf()).toEqual({
    layoutShift: 0.01,
    clicks: { 'sign-up': 3 },
  });
  expect(budgetsOf(JSON.stringify({ layoutShift: 0.05, clicks: { 'sign-in': 4 } }))).toEqual({
    layoutShift: 0.05,
    clicks: { 'sign-up': 3, 'sign-in': 4 },
  });
});

test('the core name comes from the journey header only', () => {
  expect(coreOf('/**\n * sign-up: A visitor signs up.\n * Core: sign-up\n */\ntest();')).toBe(
    'sign-up',
  );
  expect(coreOf('/**\n * notes: A note syncs.\n */\n// Core: sign-up\n')).toBeNull();
});

test('a try that fails with no measured budget is a timeout, an assertion or a crash', () => {
  expect(kindOf({ status: 'timedOut', error: undefined })).toBe('timeout');
  expect(
    kindOf({ status: 'failed', error: { message: 'locator.click: Timeout 10000ms exceeded.' } }),
  ).toBe('timeout');
  expect(
    kindOf({
      status: 'failed',
      error: {
        message: 'Error: outcome signed-in: the text\n\nexpect(locator).toBeVisible() failed',
      },
    }),
  ).toBe('assertion');
  expect(kindOf({ status: 'failed', error: { message: 'TypeError: x is undefined' } })).toBe(
    'crash',
  );
});

test('the first failure of a try is the one it keeps', () => {
  const run = measure(null, []);
  markFailure(run, 'axe', 'axe found violations');
  markFailure(run, 'crash', 'later');
  expect(run.failure).toEqual({ kind: 'axe', message: 'axe found violations' });
});
