import { expect, test } from 'bun:test';

import { fake } from '@tools/github/fake-run';
import {
  weakerBudgets,
  weakerCi,
  weakerCore,
  weakerJourney,
  weakerJourneys,
} from '@tools/github/weaker-journeys';

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

const ci = (uses: string, run: string) =>
  `jobs:\n  journeys:\n    steps:\n      - uses: ${uses}\n      - run: ${run}\n`;

test('a changed command in the journeys job holds, and a pinned action does not', () => {
  expect(weakerCi(ci('a@1', 'bun x --all'), ci('a@2', 'bun x --all'))).toEqual([]);
  expect(weakerCi(ci('a@1', 'bun x --all'), ci('a@1', 'true'))).toEqual([
    '.github/workflows/ci.yml: the PR changes the commands of the journeys job.',
  ]);
});

test('a changed coreJourneys decision holds, and a new one does not', () => {
  const old = 'coreJourneys:\n  sign-up: yes\n';
  expect(weakerCore(old, `${old}  billing: yes\n`)).toEqual([]);
  expect(weakerCore(old, 'coreJourneys:\n  sign-up: n/a\n')).toEqual([
    'clutch.yaml: the PR changes the coreJourneys decision for `sign-up`.',
  ]);
});

test('a removed screen or route holds, and a renamed one does not', async () => {
  const gh = fake([
    ['git merge-base', { out: 'b4se\n' }],
    [
      'git diff --name-status',
      {
        out: 'D\tfeatures/a/screens/x.tsx\nD\tapps/web/app/pay.tsx\nD\tapps/web/app/_layout.tsx\nR100\tfeatures/a/screens/y.tsx\tfeatures/a/screens/z.tsx\n',
      },
    ],
  ]);
  expect(await weakerJourneys(gh.run, 'main', 'h3ad')).toEqual([
    'features/a/screens/x.tsx: the PR removes this screen, with no rename.',
    "apps/web/app/pay.tsx: the PR removes this file of the app's routes, with no rename.",
  ]);
});

test('a change to the journey kit holds', async () => {
  const gh = fake([
    ['git merge-base', { out: 'b4se\n' }],
    [
      'git diff --name-status',
      { out: 'M\tpackages/journeys/testing/outcome.ts\nA\ttools/journeys/x.ts\nM\tapps/a.ts\n' },
    ],
  ]);
  expect(await weakerJourneys(gh.run, 'main', 'h3ad')).toEqual([
    'packages/journeys/testing/outcome.ts: the PR changes the journey kit that proves every journey.',
    'tools/journeys/x.ts: the PR changes the journey kit that proves every journey.',
  ]);
});

const notes = 'features/notes/journeys/notes-sync.journey.ts';
const steps = await Bun.file(new URL(`../../${notes}`, import.meta.url)).text();

test('the same steps of a data journey are not weaker', () => {
  expect(weakerJourney(notes, steps, steps)).toEqual([]);
});

test('a deleted see step of a data journey is weaker, and the reason names the journey', () => {
  const head = steps.replace("  see(heading('General', 1)),\n", '');
  expect(head).not.toBe(steps);
  expect(weakerJourney(notes, steps, head)).toEqual([
    `${notes}: it no longer proves the step \`see(heading('General', 1))\`.`,
  ]);
});

test('one of two equal see steps is still a lost step', () => {
  const head = steps.replace("  see(button('Open notes')),\n", '');
  expect(weakerJourney(notes, steps, head)).toEqual([
    `${notes}: it no longer proves the step \`see(button('Open notes'))\`.`,
  ]);
});

test('a proving step that expects something else is weaker', () => {
  const head = steps.replace(
    "serverHolds(notesOf, 'general', 'title', [agent, offlineTitle])",
    "serverHolds(notesOf, 'general', 'title', [agent])",
  );
  expect(weakerJourney(notes, steps, head)).toEqual([
    `${notes}: it no longer proves the step \`serverHolds(notesOf, 'general', 'title', [agent, offlineTitle])\`.`,
  ]);
});

test('a changed string constant changes each step that proves with it', () => {
  const head = steps.replace("const agent = 'Agent note';", "const agent = 'A';");
  expect(weakerJourney(notes, steps, head)).toEqual([
    `${notes}: it no longer proves the step \`see(fieldWith(noteTitle, agent))\`.`,
    `${notes}: it no longer proves the step \`serverHolds(notesOf, 'general', 'title', [agent, offlineTitle])\`.`,
    `${notes}: it no longer proves the step \`onSecond(see(fieldWith(noteTitle, agent)))\`.`,
    `${notes}: it no longer proves the step \`holds(noteRecord, 'title', [agent, offlineTitle])\`.`,
  ]);
});

test('a step that moves into webOnly is weaker', () => {
  const head = steps.replace(
    '  see(fieldWith(noteTitle, renamed)),\n',
    "  webOnly(see(fieldWith(noteTitle, renamed)), 'no device'),\n",
  );
  expect(weakerJourney(notes, steps, head)).toEqual([
    `${notes}: the step \`see(fieldWith(noteTitle, renamed))\` moves into \`webOnly\`, so the native run no longer proves it.`,
  ]);
});

test('a new label in a tap step, new formatting or a new webOnly reason is not weaker', () => {
  const head = steps
    .replace("tap(button('Add'))", "tap(button('Add note'))")
    .replace("see(heading('General', 1))", 'see(heading("General", 1,))')
    .replace("const axe = 'axe reads a web page';", "const axe = 'axe needs a page';");
  expect(head).not.toBe(steps);
  expect(weakerJourney(notes, steps, head)).toEqual([]);
});

test('a deleted data journey holds, and one moved to another form is not compared', async () => {
  const gh = fake([
    ['git merge-base', { out: 'b4se\n' }],
    [
      'git diff --name-status',
      { out: `D\t${notes}\nR060\tfeatures/a/journeys/b.pw.ts\tfeatures/a/journeys/b.journey.ts\n` },
    ],
  ]);
  expect(await weakerJourneys(gh.run, 'main', 'h3ad')).toEqual([
    `${notes}: the PR deletes this journey.`,
    'features/a/journeys/b.journey.ts: the PR moves the journey features/a/journeys/b.pw.ts to another form, so no check compares them.',
  ]);
});

test('a changed data journey is compared with its base copy', async () => {
  const gh = fake([
    ['git merge-base', { out: 'b4se\n' }],
    ['git diff --name-status', { out: `M\t${notes}\n` }],
    [`git show b4se:${notes}`, { out: steps }],
    [
      `git show h3ad:${notes}`,
      {
        out: steps
          .replace('  settled(),\n', '')
          .replace('webOnly(settled(), poolOfThePage),\n', ''),
      },
    ],
  ]);
  expect(await weakerJourneys(gh.run, 'main', 'h3ad')).toEqual([
    `${notes}: it no longer proves the step \`settled()\`.`,
  ]);
});
