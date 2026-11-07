import { expect, test } from 'bun:test';

import { core, coreRepo, placeholder, see, signUp } from '@tools/journeys/core-fixtures';

/** The bypasses that the council reviews of CL-440 found, each now a failing journey. See core-rules.ts. */

test('outcomes that hold on the entry screen, a mocked backend, page scripts and a self-written record fail', async () => {
  const file = 'features/account/journeys/sign-up.pw.ts';
  // The bypasses of the second review: each outcome holds on the entry page.
  const body = [
    "import { test } from '@playwright/test';",
    "import { outcomes } from '@repo/journeys/testing/outcome';",
    "test('a visitor signs up', async ({ page }) => {",
    '  const outcome = outcomes(page);',
    '  const o = outcomes(page);',
    "  await page.route('**/api/me', (route) => route.fulfill({ json: { plan: 'pro' } }));",
    "  await page.evaluate(() => fetch('/api/login', { method: 'POST' }));",
    "  await page.evaluate(() => history.pushState({}, '', '/billing'));",
    '  const go = page.goto.bind(page);',
    "  const fs = await import('node:fs');",
    "  await page.goto('/');",
    "  await outcome('signed-up', { url: '/' });",
    "  await outcome('email-verified', { url: '/' });",
    "  await outcome('email-taken-refused', { url: '/' });",
    "  await outcome('weak-password-refused', { url: '/' });",
    '});',
  ].join('\n');
  expect(await coreRepo({ [file]: core('sign-up', 'sign-up', body) })).toEqual([
    `${file}: it binds \`outcomes(page)\` to a name other than \`outcome\`. Write \`const outcome = outcomes(page)\`, so a check can read each outcome. ${see}`,
    `${file}: it changes the URL or runs code in the page without a tap. A core journey reaches each screen through the buttons that a user taps. ${see}`,
    `${file}: it loads a seed fixture, a saved session or a token, or logs in through the API. A core journey makes a new account through the sign-up screens. ${see}`,
    `${file}: it reaches past the page, through a dynamic import, \`require\`, the environment or the file system. ${see}`,
    `${file}: lines 5, 6, 7, 8, 9, 10 are not steps that a core journey takes. A test holds only page steps from \`page\`, outcomes, journey kit calls and consts of plain values. ${see}`,
    `${file}: no user step comes before \`signed-up\`, \`email-verified\`, \`email-taken-refused\`, \`weak-password-refused\`. Each outcome comes after a tap, a fill or a reload, so it cannot hold on the screen before. ${see}`,
  ]);
});

test('bracket access, a template that hides code, a fake step and a branch fail', async () => {
  const file = 'features/account/journeys/sign-up.pw.ts';
  // The probes of the third review.
  const body = [
    "import { test } from '@playwright/test';",
    "import { outcomes } from '@repo/journeys/testing/outcome';",
    "test.use({ extraHTTPHeaders: { authorization: 'Bearer pro' } });",
    "test('a visitor signs up', async ({ page }) => {",
    '  const outcome = outcomes(page);',
    "  await page.goto('/');",
    "  await page['goto']('/settings');",
    "  await globalThis['fetch']('/api/test/seed');",
    `  const t = \`${placeholder('1')}\`;`,
    "  await page.setExtraHTTPHeaders({ authorization: 'Bearer pro' });",
    '  const u = `x`;',
    "  await page.getByRole('button', { name: 'Sign up' }).click();",
    "  await outcome('signed-up', { url: '/home' });",
    "  const fake = '.click(';",
    "  await outcome('email-verified', { text: 'Email verified' });",
    "  if (Math.random() > 2) await page.locator('#a').click();",
    "  await outcome('email-taken-refused', { text: 'Taken' });",
    '  if (t === u) {',
    "    await outcome('weak-password-refused', { text: 'Weak' });",
    '  }',
    '});',
  ].join('\n');
  expect(await coreRepo({ [file]: core('sign-up', 'sign-up', body) })).toEqual([
    `${file}: an outcome sits inside a branch, a loop or a helper. Write each one as its own \`await outcome(…)\` line in the test, so it runs in order. ${see}`,
    `${file}: it changes the URL or runs code in the page without a tap. A core journey reaches each screen through the buttons that a user taps. ${see}`,
    `${file}: it does not assert \`weak-password-refused\`, which the catalog names for sign-up. ${see}`,
    `${file}: it loads a seed fixture, a saved session or a token, or logs in through the API. A core journey makes a new account through the sign-up screens. ${see}`,
    `${file}: it reaches a member through brackets. Write each call by name, such as \`page.goto('/')\`, so a check can read it. ${see}`,
    `${file}: lines 3, 7, 8, 10, 16, 18 are not steps that a core journey takes. A test holds only page steps from \`page\`, outcomes, journey kit calls and consts of plain values. ${see}`,
    `${file}: no user step comes before \`email-verified\`, \`email-taken-refused\`. Each outcome comes after a tap, a fill or a reload, so it cannot hold on the screen before. ${see}`,
  ]);
});

test('reflection, a constructor, page scripts, a fake screen, a destructured goto, a stand-in click and a hook fail', async () => {
  const file = 'features/account/journeys/sign-up.pw.ts';
  // The probes of the fourth review.
  const body = [
    "import { test } from '@playwright/test';",
    "import { outcomes } from '@repo/journeys/testing/outcome';",
    "test.beforeEach(async ({ page }) => { await page.getByRole('button').click(); });",
    "test('a visitor signs up', async ({ page }) => {",
    '  const outcome = outcomes(page);',
    "  await page.goto('/');",
    "  await Reflect.get(page, 'evaluate').call(page, 'x');",
    "  await (async () => {}).constructor('return 1')();",
    "  await page.waitForFunction('true');",
    "  await page.addScriptTag({ content: 'x' });",
    "  await page.setContent('<h1>Welcome</h1>');",
    '  const { goto: open } = page;',
    '  const user = { click: async () => {} };',
    "  await page.getByRole('button', { name: 'Sign up' }).click();",
    "  await outcome('signed-up', { url: '/home' });",
    '  await user.click();',
    "  await outcome('email-verified', { text: 'Welcome' });",
    "  await page.getByRole('link', { name: 'Again' }).click();",
    "  await outcome('email-taken-refused', { text: 'Taken' });",
    "  await page.getByLabel('Password').fill('short');",
    "  await outcome('weak-password-refused', { text: 'Weak' });",
    '});',
  ].join('\n');
  expect(await coreRepo({ [file]: core('sign-up', 'sign-up', body) })).toEqual([
    `${file}: lines 3, 7, 8, 9, 10, 11, 12, 13, 16 are not steps that a core journey takes. A test holds only page steps from \`page\`, outcomes, journey kit calls and consts of plain values. ${see}`,
    `${file}: no user step comes before \`email-verified\`. Each outcome comes after a tap, a fill or a reload, so it cannot hold on the screen before. ${see}`,
  ]);
});

test('an import that leaves the journey kit, a side-effect import or a test from elsewhere fails', async () => {
  const file = 'features/account/journeys/sign-up.pw.ts';
  // The probe of the fifth review: `..` in the path reaches a fixture that no rule reads.
  const body = signUp
    .replace(
      "import { test } from '@playwright/test';",
      [
        "import { test } from '@repo/journeys/testing/../../../../apps/web/journeys/fixtures';",
        "import { seedless } from '@repo/journeys/testing/../x';",
        "import '@repo/journeys/testing/outcome';",
      ].join('\n'),
    )
    .replace("  await page.goto('/');", "  await page.goto('/');\n  await seedless(page, 'x');");
  const problems = await coreRepo({ [file]: core('sign-up', 'sign-up', body) });
  expect(problems).toContain(
    `${file}: it imports @repo/journeys/testing/../../../../apps/web/journeys/fixtures. A core journey imports only @playwright/test and @repo/journeys/testing, so every step is in the journey. ${see}`,
  );
  expect(problems).toContain(
    `${file}: it imports @repo/journeys/testing/../x. A core journey imports only @playwright/test and @repo/journeys/testing, so every step is in the journey. ${see}`,
  );
  expect(problems.find((item) => item.includes('are not steps'))).toContain(
    'lines 1, 2, 3, 8 are not steps',
  );
});
