import { expect, test } from 'bun:test';

import {
  budgetsOf,
  checkClickBudget,
  coreOf,
  layoutShift,
  layoutShiftProblem,
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
  device: 'Pixel 7',
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
    atMs: 0,
    clicks: count,
    keys: 0,
    steps: count,
  })),
  axe: [],
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
    value: 0.013,
    page: '/sign-up',
    elements: ['p "Loading"', 'form#sign-up'],
  });
  expect(layoutShift([])).toEqual({ value: 0, page: null, elements: [] });
});

test('a window ends 5 s after it starts, even with no gap', () => {
  const shifts = Array.from({ length: 12 }, (_, index) => shift(0.002, index * 900, ['div']));
  expect(layoutShift(shifts).value).toBe(0.012);
});

test('a layout shift at the budget fails and names the shifted element, and one under it passes', () => {
  const over = measure(null, [], [shift(0.01, 0, ['div[data-testid="banner"] "Welcome"'])]);
  expect(layoutShiftProblem(over)).toBe(
    'The layout shift on /sign-up is 0.01, at or over the budget of 0.01 in `budgets.layoutShift` of clutch.yaml. It moved div[data-testid="banner"] "Welcome". Reserve the space of content that loads late. See docs/contributing/end-to-end-testing.md#budgets.',
  );
  expect(layoutShiftProblem(measure(null, [], [shift(0.009, 0, ['div'])]))).toBeNull();
});

test('a sign-up with 4 clicks fails its budget of 3, and one with 3 passes', () => {
  expect(() => checkClickBudget(measure('sign-up', [['signed-up', 4]]), 'signed-up')).toThrow(
    'sign-up took 4 clicks, taps or presses of Enter from the entry to `signed-up`, over its budget of 3',
  );
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
    'sign-in took 4 clicks, taps or presses of Enter from `signed-up` to `signed-in`, over its budget of 3',
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
