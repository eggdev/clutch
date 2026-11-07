import { expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import path from 'node:path';

import { checkJourneys } from '@tools/check-journeys';
import { coreJourneys, verificationFile } from '@tools/journeys/journeys';
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
  '});',
].join('\n');

const nativeSignUp = [
  'appId: com.example',
  '---',
  '- launchApp: { clearState: true }',
  '- tapOn: Sign up',
  "- assertVisible: { text: Welcome, label: 'outcome signed-up' }",
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

test('a core journey that opens the entry, signs up and asserts through outcomes passes', async () => {
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

test('a core journey that opens a second URL, uses a seeded account, skips sign-up or asserts with expect fails', async () => {
  const file = 'features/account/journeys/sign-in.pw.ts';
  const body = [
    "import { expect, test } from '@playwright/test';",
    "import { seededMember } from '../testing/seed';",
    "test('a member signs in', async ({ page }) => {",
    "  await page.goto('/');",
    "  await page.goto('/sign-in');",
    '  await page.goto(url);',
    "  await expect(page.getByText('Welcome')).toBeVisible();",
    '});',
  ].join('\n');
  expect(
    await coreRepo({
      [file]: core('sign-in', 'sign-in', body),
      'features/account/journeys/search.pw.ts': core('search', 'search', signUp),
    }),
  ).toEqual([
    'features/account/journeys/search.pw.ts: `Core: search` names no core journey. Use one of sign-up, sign-in, onboarding, profile-management, billing-and-checkout, roles-and-access, account-security, contact-support.',
    `${file}: it asserts with \`expect\`. A core journey asserts only through \`outcome(name, expected)\` from @repo/journeys/testing/outcome. See docs/contributing/journeys/core.md.`,
    `${file}: it does not create its account through the sign-up screens. Walk sign-up from the entry, and assert \`outcome('signed-up', …)\`. See docs/contributing/journeys/core.md.`,
    `${file}: it loads a seed fixture or a saved session. A core journey makes a new account through the sign-up screens. See docs/contributing/journeys/core.md.`,
    `${file}: it opens '/sign-in'. A core journey opens only the entry, \`/\`, and reaches each screen through the app. See docs/contributing/journeys/core.md.`,
    `${file}: it opens url. A core journey opens only the entry, \`/\`, and reaches each screen through the app. See docs/contributing/journeys/core.md.`,
  ]);
});

test('a native core journey that opens a link, uses a seed or asserts with no outcome label fails', async () => {
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
        '- runScript: seed-member.js',
        '- openLink: example://sign-in',
        '- assertVisible: Welcome',
        '',
      ].join('\n'),
    }),
  ).toEqual([
    `${file}: it does not create its account through the sign-up screens. Walk sign-up from the entry, and assert an outcome with \`label: outcome signed-up\`. See docs/contributing/journeys/core.md.`,
    `${file}: it has an assertion with no \`label: outcome <name>\`. A core journey asserts only through outcomes. See docs/contributing/journeys/core.md.`,
    `${file}: it loads a seed fixture or a saved session. A core journey makes a new account through the sign-up screens. See docs/contributing/journeys/core.md.`,
    `${file}: it never opens the entry. Start with \`launchApp\`.`,
    `${file}: it opens a link. A core journey starts with \`launchApp\`, and reaches each screen through the app. See docs/contributing/journeys/core.md.`,
  ]);
});

test('the core journey list matches the headings of the catalog', () => {
  const catalog = readFileSync(
    path.join(import.meta.dir, '../docs/contributing/journeys/core.md'),
    'utf-8',
  );
  const names = [...catalog.matchAll(/^## .+ \(`([a-z-]+)`\)$/gmu)].map((match) => match[1]);
  expect(names).toEqual([...coreJourneys]);
});
