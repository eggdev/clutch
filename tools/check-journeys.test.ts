import { expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import path from 'node:path';

import { checkJourneys } from '@tools/check-journeys';
import { coreJourneys, coreOutcomes, verificationFile } from '@tools/journeys/journeys';
import { inRepo } from '@tools/testing/in-repo';

const app = (features: Array<string>, tags: Array<string> = []) =>
  JSON.stringify({
    dependencies: Object.fromEntries(features.map((name) => [`@features/${name}`, 'workspace:*'])),
    nx: { tags },
  });

const header = (id: string) =>
  `/**\n * ${id}: A member pays an invoice.\n * Contract: docs/a.md\n * Entry: the home page\n * Isolation and cleanup: a unique invoice\n */\n`;

const flow = (id: string, platform = 'web') => ({
  platform,
  commands: [['mise', 'exec', '--', 'bun', 'run', 'journey', id]],
});

test('a shipped feature with a registered journey for each platform passes', async () => {
  expect(
    await inRepo(
      {
        'apps/web/package.json': app(['billing']),
        'apps/mobile/package.json': app(['billing'], ['platform:native']),
        'features/billing/screens/billing-screen.tsx': '',
        'features/billing/journeys/pay-invoice.pw.ts': header('pay-invoice'),
        'features/billing/journeys/pay-on-phone.maestro.yaml':
          '# pay-on-phone: A member pays an invoice.\n# Contract: docs/a.md\n# Entry: the app icon\n# Isolation and cleanup: a unique invoice\nappId: com.example\n',
        // A feature with no screen has nothing to drive yet.
        'features/reports/gate.ts': '',
        [verificationFile]: JSON.stringify({
          flows: {
            'pay-invoice': flow('pay-invoice'),
            'pay-on-phone': flow('pay-on-phone', 'native'),
          },
        }),
      },
      checkJourneys,
    ),
  ).toEqual([]);
});

test('a shipped feature with no journey, a bare journey, and an unregistered or dangling flow fail', async () => {
  expect(
    await inRepo(
      {
        'apps/web/package.json': app(['billing', 'notes']),
        'features/billing/screens/billing-screen.tsx': '',
        'features/notes/screens/notes-screen.tsx': '',
        'features/notes/journeys/notes-sync.pw.ts': "import { test } from '@playwright/test';\n",
        [verificationFile]: JSON.stringify({ flows: { 'old-journey': flow('old-journey') } }),
      },
      checkJourneys,
    ),
  ).toEqual([
    `${verificationFile}: the flow \`old-journey\` runs the journey \`old-journey\`, which does not exist. Remove the flow, or restore the journey file.`,
    'features/billing: the web app ships it, but it has no web journey. Add features/billing/journeys/<id>.pw.ts with the spec header from .agents/skills/setup-verification/references/journey-specification.md.',
    `features/notes/journeys/notes-sync.pw.ts: ${verificationFile} does not register it. Add the flow \`notes-sync\` with \`"platform": "web"\` and \`"commands": [["mise","exec","--","bun","run","journey","notes-sync"]]\`.`,
    'features/notes/journeys/notes-sync.pw.ts: the header has no `Contract:` line. Add it.',
    'features/notes/journeys/notes-sync.pw.ts: the header has no `Entry:` line. Add it.',
    'features/notes/journeys/notes-sync.pw.ts: the header has no `Isolation and cleanup:` line. Add it.',
    'features/notes/journeys/notes-sync.pw.ts: the header starts with `notes-sync: <user goal>`. Write the goal on the first header line.',
  ]);
});

const core = (id: string, name: string, body: string) =>
  `/**\n * ${id}: A visitor proves a core journey.\n * Contract: docs/contributing/journeys/core.md\n * Entry: the first screen\n * Isolation and cleanup: a new account\n * Core: ${name}\n */\n${body}`;

const signUp = [
  "import { test } from '@playwright/test';",
  "import { outcomes } from '@repo/journeys/testing/outcome';",
  "test('a visitor signs up', async ({ page }) => {",
  '  const outcome = outcomes(page);',
  "  await page.goto('/');",
  "  await page.getByRole('button', { name: 'Sign up' }).click();",
  "  await outcome('signed-up', { url: '/home', text: 'Welcome' });",
  "  await outcome('email-verified', { text: 'Email verified' });",
  "  await outcome('email-taken-refused', { text: 'That email has an account' });",
  "  await outcome('weak-password-refused', { text: 'Use a longer password' });",
  '});',
].join('\n');

const nativeSignUp = [
  'appId: com.example',
  '---',
  '- launchApp: { clearState: true }',
  '- tapOn: Sign up',
  "- assertVisible: { text: Welcome, label: 'outcome signed-up' }",
  "- assertVisible: { text: Email verified, label: 'outcome email-verified' }",
  "- assertVisible: { text: That email has an account, label: 'outcome email-taken-refused' }",
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
    `${file}: it changes the URL without a tap. A core journey reaches each screen through the buttons that a user taps. ${see}`,
    `${file}: it does not assert \`signed-up\`, \`plan-upgraded\`, \`plan-cancelled\`, \`card-declined\`, \`renewal-failed\`, which the catalog names for billing-and-checkout. ${see}`,
    `${file}: it does not create its account through the sign-up screens first. Walk sign-up from the entry, and assert the \`signed-up\` outcome before any other. ${see}`,
    `${file}: it imports ./fixtures. A core journey imports only @playwright/test and @repo/journeys/testing, so every step is in the journey. ${see}`,
    `${file}: it loads a seed fixture, a saved session or a token, or logs in through the API. A core journey makes a new account through the sign-up screens. ${see}`,
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
    "  await outcome('signed-up', { url: '/home' });",
    "  await outcome(name, { url: '/home' });",
    "  await outcome('signed-in', { url: '/home' });",
    '});',
  ].join('\n');
  expect(await coreRepo({ [file]: core('sign-in', 'sign-in', body) })).toEqual([
    `${file}: an outcome name is not a literal string. Write each name as a string, such as \`outcome('signed-in', …)\`, so a check can read it. ${see}`,
    `${file}: it does not assert \`signed-out\`, \`session-kept\`, \`wrong-password-refused\`, which the catalog names for sign-in. ${see}`,
    `${file}: it opens '/sign-in'. A core journey opens only the entry, \`/\`, and reaches each screen through the app. ${see}`,
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
    `${file}: it runs another flow. A core journey keeps every step in its own file, so a check can read it. ${see}`,
  ]);
});

test('the core outcomes match the outcomes and failure states of the catalog', () => {
  const text = readFileSync(
    path.join(import.meta.dir, '../docs/contributing/journeys/core.md'),
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

test('the core journey list matches the headings of the catalog', () => {
  const catalog = readFileSync(
    path.join(import.meta.dir, '../docs/contributing/journeys/core.md'),
    'utf-8',
  );
  const names = [...catalog.matchAll(/^## .+ \(`([a-z-]+)`\)$/gmu)].map((match) => match[1]);
  expect(names).toEqual([...coreJourneys]);
});
