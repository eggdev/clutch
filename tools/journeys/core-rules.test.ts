import { expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import path from 'node:path';

import { checkJourneys } from '@tools/check-journeys';
import { coreOutcomes, verificationFile } from '@tools/journeys/journeys';
import { inRepo } from '@tools/testing/in-repo';

/** The rules for `Core:` journeys, run through check-journeys. See core-rules.ts. */

const flow = (id: string, platform = 'web') => ({
  platform,
  commands: [['mise', 'exec', '--', 'bun', 'run', 'journey', id]],
});

/** A template placeholder, built so that no string literal holds one. */
const placeholder = (inner: string) => `$${'{'}${inner}}`;

const core = (id: string, name: string, body: string) =>
  `/**\n * ${id}: A visitor proves a core journey.\n * Contract: docs/contributing/journeys/core.md\n * Entry: the first screen\n * Isolation and cleanup: a new account\n * Core: ${name}\n */\n${body}`;

const signUp = [
  "import { test } from '@playwright/test';",
  "import { outcomes } from '@repo/journeys/testing/outcome';",
  "test('a visitor signs up', async ({ page }) => {",
  '  const outcome = outcomes(page);',
  "  await page.goto('/');",
  "  await page.getByRole('button', { name: 'Sign up' }).click();",
  "  await page.getByRole('button', { name: 'Create account' }).click();",
  "  await outcome('signed-up', { url: '/home', text: 'Welcome' });",
  "  await page.getByRole('link', { name: 'Verify email' }).click();",
  "  await outcome('email-verified', { text: 'Email verified' });",
  "  await page.getByRole('button', { name: 'Sign out' }).click();",
  "  await page.getByLabel('Email').fill('taken@example.com');",
  "  await outcome('email-taken-refused', { text: 'That email has an account' });",
  "  await page.getByLabel('Password').fill('short');",
  "  await outcome('weak-password-refused', { text: 'Use a longer password' });",
  '});',
].join('\n');

const nativeSignUp = [
  'appId: com.example',
  '---',
  '- launchApp: { clearState: true }',
  '- tapOn: Sign up',
  "- assertVisible: { text: Welcome, label: 'outcome signed-up' }",
  '- tapOn: Verify email',
  "- assertVisible: { text: Email verified, label: 'outcome email-verified' }",
  '- tapOn: Sign out',
  '- inputText: taken@example.com',
  "- assertVisible: { text: That email has an account, label: 'outcome email-taken-refused' }",
  '- inputText: short',
  "- assertVisible: { text: Use a longer password, label: 'outcome weak-password-refused' }",
  '',
].join('\n');

const coreRepo = (files: Record<string, string>) =>
  inRepo(
    {
      ...files,
      [verificationFile]: JSON.stringify({
        flows: Object.fromEntries(
          Object.keys(files).map((file) => {
            const id = file.split('/').at(-1)?.split('.')[0] ?? '';
            return [id, flow(id, file.endsWith('.maestro.yaml') ? 'native' : 'web')];
          }),
        ),
      }),
    },
    checkJourneys,
  );

const see = 'See docs/contributing/journeys/core.md.';

test('a core journey that opens the entry, signs up first and asserts each catalog outcome passes', async () => {
  expect(
    await coreRepo({
      'features/account/journeys/sign-up.pw.ts': core('sign-up', 'sign-up', signUp),
      'features/account/journeys/phone-sign-up.maestro.yaml': [
        '# phone-sign-up: A visitor makes an account on a phone.',
        '# Contract: docs/contributing/journeys/core.md',
        '# Entry: the app icon',
        '# Isolation and cleanup: a new account',
        '# Core: sign-up',
        nativeSignUp,
      ].join('\n'),
    }),
  ).toEqual([]);
});

test('a core journey that gets around the rules through a fixture, an API login, a URL change, a renamed expect or a comment fails', async () => {
  const file = 'features/account/journeys/billing.pw.ts';
  // A bypass that the first version of these rules let through.
  const body = [
    "import { test } from './fixtures';",
    "import { expect as check } from '@playwright/test';",
    "test('a member upgrades', async ({ page }) => {",
    "  await page.request.post('/api/test/login-pro');",
    "  await page.goto('/');",
    "  await page.evaluate(() => location.assign('/billing'));",
    "  // outcome('signed-up', {})",
    "  await check(page.getByText('Pro')).toBeVisible();",
    '});',
  ].join('\n');
  expect(await coreRepo({ [file]: core('billing', 'billing-and-checkout', body) })).toEqual([
    `${file}: it asserts with \`expect\`. A core journey asserts only through \`outcome(name, expected)\` from @repo/journeys/testing/outcome. ${see}`,
    `${file}: it changes the URL or runs code in the page without a tap. A core journey reaches each screen through the buttons that a user taps. ${see}`,
    `${file}: it does not assert \`signed-up\`, \`plan-upgraded\`, \`plan-cancelled\`, \`card-declined\`, \`renewal-failed\`, which the catalog names for billing-and-checkout. ${see}`,
    `${file}: it does not create its account through the sign-up screens first. Walk sign-up from the entry, and assert the \`signed-up\` outcome before any other. ${see}`,
    `${file}: it imports ./fixtures. A core journey imports only @playwright/test and @repo/journeys/testing, so every step is in the journey. ${see}`,
    `${file}: it loads a seed fixture, a saved session or a token, or logs in through the API. A core journey makes a new account through the sign-up screens. ${see}`,
    `${file}: lines 4, 6, 8 are not steps that a core journey takes. A test holds only page steps from \`page\`, outcomes, journey kit calls and consts of plain values. ${see}`,
  ]);
});

test('a core journey that opens a second URL, names an outcome with a variable or skips catalog outcomes fails', async () => {
  const file = 'features/account/journeys/sign-in.pw.ts';
  const body = [
    "import { test } from '@playwright/test';",
    "import { outcomes } from '@repo/journeys/testing/outcome';",
    "test('a member signs in', async ({ page }) => {",
    '  const outcome = outcomes(page);',
    "  await page.goto('/');",
    "  await page.goto('/sign-in');",
    "  await page.getByRole('button', { name: 'Sign up' }).click();",
    "  await outcome('signed-up', { url: '/home' });",
    "  await page.getByRole('button', { name: 'Sign out' }).click();",
    "  await outcome(name, { url: '/home' });",
    "  await page.getByRole('button', { name: 'Sign in' }).click();",
    "  await outcome('signed-in', { url: '/home' });",
    '});',
  ].join('\n');
  expect(await coreRepo({ [file]: core('sign-in', 'sign-in', body) })).toEqual([
    `${file}: an outcome name is not a literal string. Write each name as a string, such as \`outcome('signed-in', …)\`, so a check can read it. ${see}`,
    `${file}: it does not assert \`signed-out\`, \`session-kept\`, \`wrong-password-refused\`, which the catalog names for sign-in. ${see}`,
    `${file}: it opens '/sign-in'. A core journey opens only the entry, \`/\`, and reaches each screen through the app. ${see}`,
    `${file}: line 10 is not a step that a core journey takes. A test holds only page steps from \`page\`, outcomes, journey kit calls and consts of plain values. ${see}`,
  ]);
});

test('a plan named Seedling is not a seed', async () => {
  const body = signUp.replace("text: 'Welcome'", "text: 'Seedling plan'");
  expect(
    await coreRepo({ 'features/account/journeys/sign-up.pw.ts': core('sign-up', 'sign-up', body) }),
  ).toEqual([]);
});

test('a native core journey that keeps its state, runs another flow, opens a link or skips outcomes fails', async () => {
  const file = 'features/account/journeys/phone-sign-in.maestro.yaml';
  expect(
    await coreRepo({
      [file]: [
        '# phone-sign-in: A member signs in on a phone.',
        '# Contract: docs/contributing/journeys/core.md',
        '# Entry: the app icon',
        '# Isolation and cleanup: a new account',
        '# Core: sign-in',
        'appId: com.example',
        '---',
        '- launchApp: { clearState: false }',
        '- runFlow: login-as-pro.yaml',
        '- runScript: seed-member.js',
        '- openLink: example://sign-in',
        "- assertVisible: { text: Welcome, label: 'outcome signed-up' }",
        '- assertVisible: Welcome',
        '',
      ].join('\n'),
    }),
  ).toEqual([
    `${file}: it does not assert \`signed-out\`, \`signed-in\`, \`session-kept\`, \`wrong-password-refused\`, which the catalog names for sign-in. ${see}`,
    `${file}: it does not start with a clean launch. Start with \`launchApp: { clearState: true }\`, so the app holds no account. ${see}`,
    `${file}: it has an assertion with no \`label: outcome <name>\`. A core journey asserts only through outcomes. ${see}`,
    `${file}: it loads a seed fixture, a saved session or a token, or logs in through the API. A core journey makes a new account through the sign-up screens. ${see}`,
    `${file}: it opens a link. A core journey starts with \`launchApp\`, and reaches each screen through the app. ${see}`,
    `${file}: it runs a script. A script can log in or seed, so a core journey takes only the steps that a user takes. ${see}`,
    `${file}: it runs another flow. A core journey keeps every step in its own file, so a check can read it. ${see}`,
    `${file}: no user step comes before \`signed-up\`. Each outcome comes after a tap, a text entry or a relaunch, so it cannot hold on the screen before. ${see}`,
  ]);
});

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

test('page text that names a seed, storage or a slash pair trips no rule', async () => {
  const body = signUp
    .replace("text: 'Welcome'", "text: 'Seed your garden in localStorage'")
    .replace("text: 'Email verified'", "text: 'a // b'");
  expect(
    await coreRepo({ 'features/account/journeys/sign-up.pw.ts': core('sign-up', 'sign-up', body) }),
  ).toEqual([]);
});

test('a native assertion that may not run or checks nothing on the screen fails', async () => {
  const file = 'features/account/journeys/phone-sign-up.maestro.yaml';
  const steps = nativeSignUp
    .replace(
      "- assertVisible: { text: Email verified, label: 'outcome email-verified' }",
      "- assertTrue: { condition: 'true', label: 'outcome email-verified' }",
    )
    .replace(
      "- assertVisible: { text: Use a longer password, label: 'outcome weak-password-refused' }",
      "- repeat: { times: 0, commands: [{ assertVisible: { text: x, optional: true, label: 'outcome weak-password-refused' } }] }",
    );
  expect(
    await coreRepo({
      [file]: [
        '# phone-sign-up: A visitor makes an account on a phone.',
        '# Contract: docs/contributing/journeys/core.md',
        '# Entry: the app icon',
        '# Isolation and cleanup: a new account',
        '# Core: sign-up',
        steps,
      ].join('\n'),
    }),
  ).toEqual([
    `${file}: it has an assertion that may not run or may not check the screen: inside \`repeat\` or \`retry\`, \`optional\`, or not \`assertVisible\` or \`assertNotVisible\`. ${see}`,
  ]);
});

test('native outcomes on one screen with no user step between them fail', async () => {
  const file = 'features/account/journeys/phone-sign-up.maestro.yaml';
  const yaml = [
    '# phone-sign-up: A visitor makes an account on a phone.',
    '# Contract: docs/contributing/journeys/core.md',
    '# Entry: the app icon',
    '# Isolation and cleanup: a new account',
    '# Core: sign-up',
    'appId: com.example',
    '---',
    '- launchApp: { clearState: true }',
    "- assertVisible: { text: Welcome, label: 'outcome signed-up' }",
    "- assertVisible: { text: Welcome, label: 'outcome email-verified' }",
    '- tapOn: Sign out',
    "- assertVisible: { text: Welcome, label: 'outcome email-taken-refused' }",
    "- assertVisible: { text: Welcome, label: 'outcome weak-password-refused' }",
    '',
  ].join('\n');
  expect(await coreRepo({ [file]: yaml })).toEqual([
    `${file}: no user step comes before \`signed-up\`, \`email-verified\`, \`weak-password-refused\`. Each outcome comes after a tap, a text entry or a relaunch, so it cannot hold on the screen before. ${see}`,
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

test('a native core journey that runs a script fails', async () => {
  const file = 'features/account/journeys/phone-sign-up.maestro.yaml';
  const yaml = nativeSignUp.replace(
    '- tapOn: Sign up',
    `- tapOn: Sign up\n- evalScript: '${placeholder('http.post("https://example.com/api/test/login")')}'`,
  );
  expect(
    await coreRepo({
      [file]: [
        '# phone-sign-up: A visitor makes an account on a phone.',
        '# Contract: docs/contributing/journeys/core.md',
        '# Entry: the app icon',
        '# Isolation and cleanup: a new account',
        '# Core: sign-up',
        yaml,
      ].join('\n'),
    }),
  ).toEqual([
    `${file}: it runs a script. A script can log in or seed, so a core journey takes only the steps that a user takes. ${see}`,
  ]);
});

test('the core outcomes match the outcomes and failure states of the catalog', () => {
  const text = readFileSync(
    path.join(import.meta.dir, '../../docs/contributing/journeys/core.md'),
    'utf-8',
  );
  const named: Record<string, ReadonlyArray<string>> = {};
  for (const section of text.split('\n## ')) {
    const name = /^[^\n]*\(`([a-z-]+)`\)/u.exec(section)?.[1];
    if (name === undefined) {
      continue;
    }
    const bullets = [...section.matchAll(/\n- (?:Outcomes|Failure states):([\s\S]*?)(?=\n- |$)/gu)];
    named[name] = bullets.flatMap((bullet) =>
      [...(bullet[1] ?? '').matchAll(/`([a-z][a-z0-9-]+)`/gu)].map((match) => match[1] ?? ''),
    );
  }
  expect(named).toEqual(coreOutcomes);
});
