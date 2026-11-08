import { expect, test } from 'bun:test';

import { fake } from '@tools/github/fake-run';
import { weakerBudgets, weakerJourney, weakerJourneys } from '@tools/github/weaker-journeys';

const file = 'features/billing/journeys/pay.pw.ts';
const base = `await click('Pay');
await outcome('paid', { url: '/done', text: 'Thanks' });
await expect(total).toHaveText('5');`;

test('a renamed button with the same outcomes is not weaker', () => {
  expect(weakerJourney(file, base, base.replace("'Pay'", "'Pay now'"))).toEqual([]);
});

test('formatting an outcome does not change what it expects', () => {
  const head = base.replace(
    "{ url: '/done', text: 'Thanks' }",
    "{\n  url: '/done',\n  text: 'Thanks',\n}",
  );
  expect(weakerJourney(file, base, head)).toEqual([]);
});

test('a removed outcome is weaker', () => {
  const head = base.replace("await outcome('paid', { url: '/done', text: 'Thanks' });\n", '');
  expect(weakerJourney(file, base, head)).toEqual([
    `${file}: it no longer proves the outcome \`paid\`.`,
    `${file}: its assertions fall from 2 to 1.`,
  ]);
});

test('a changed expected result is weaker, at the same count of assertions', () => {
  expect(weakerJourney(file, base, base.replace("'Thanks'", "'T'"))).toEqual([
    `${file}: it changes what the outcome \`paid\` expects.`,
  ]);
});

test('a removed assertion is weaker', () => {
  expect(
    weakerJourney(file, base, base.replace("await expect(total).toHaveText('5');", '')),
  ).toEqual([`${file}: its assertions fall from 2 to 1.`]);
});

test('a native journey keeps its labelled outcomes and its assertions', () => {
  const flow = 'features/a/journeys/b.maestro.yaml';
  const old =
    '- assertVisible: x\n  label: outcome signed-up\n- assertVisible: y\n  label: outcome paid\n';
  expect(weakerJourney(flow, old, old)).toEqual([]);
  expect(weakerJourney(flow, old, '- assertVisible: x\n  label: outcome signed-up\n')).toEqual([
    `${flow}: it no longer proves the outcome \`paid\`.`,
    `${flow}: its assertions fall from 2 to 1.`,
  ]);
});

test('a raised or removed budget is weaker, and a stricter one is not', () => {
  const old = 'budgets:\n  layoutShift: 0.01\n  clicks:\n    sign-up: 3\n';
  expect(weakerBudgets(old, old.replace('sign-up: 3', 'sign-up: 2'))).toEqual([]);
  expect(weakerBudgets(old, old.replace('sign-up: 3', 'sign-up: 4'))).toEqual([
    'clutch.yaml: the budget `budgets.clicks.sign-up` rises from 3 to 4.',
  ]);
  expect(weakerBudgets(old, 'budgets:\n  clicks:\n    sign-up: 3\n')).toEqual([
    'clutch.yaml: the budget `budgets.layoutShift` is gone.',
  ]);
});

test('the PR compares with its merge base, and a deleted journey holds', async () => {
  const gh = fake([
    ['git merge-base', { out: 'b4se\n' }],
    [
      'git diff --name-status',
      { out: `D\t${file}\nA\tfeatures/x/journeys/new.pw.ts\nM\tapps/web/a.ts\n` },
    ],
  ]);
  expect(await weakerJourneys(gh.run, 'main', 'h3ad')).toEqual([
    `${file}: the PR deletes this journey.`,
  ]);
  expect(gh.calls.some((call) => call.includes('merge-base origin/main h3ad'))).toBe(true);
});

test('a renamed journey is compared with its old copy', async () => {
  const moved = 'features/billing/journeys/checkout.pw.ts';
  const gh = fake([
    ['git merge-base', { out: 'b4se\n' }],
    ['git diff --name-status', { out: `R100\t${file}\t${moved}\n` }],
    [`git show b4se:${file}`, { out: base }],
    [`git show h3ad:${moved}`, { out: base.replace("'Thanks'", "'T'") }],
  ]);
  expect(await weakerJourneys(gh.run, 'main', 'h3ad')).toEqual([
    `${moved}: it changes what the outcome \`paid\` expects.`,
  ]);
});
