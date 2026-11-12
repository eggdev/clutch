import { expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import path from 'node:path';

import { checkJourneys } from '@tools/check-journeys';
import { coreJourneys, verificationFile } from '@tools/journeys/journeys';
import { inRepo } from '@tools/testing/in-repo';

/** An app that depends on React, with the features it ships, and the extra dependencies and scripts it names. */
const app = (
  features: Array<string>,
  options: { dependencies?: Record<string, string>; scripts?: Record<string, string> } = {},
) =>
  JSON.stringify({
    dependencies: {
      react: '19.2.3',
      ...Object.fromEntries(features.map((name) => [`@features/${name}`, 'workspace:*'])),
      ...options.dependencies,
    },
    scripts: options.scripts ?? {},
  });

/** A native app that ships billing: it depends on React Native, and it has no web build. */
const nativeApp = JSON.stringify({
  dependencies: { 'react-native': '0.86.3', '@features/billing': 'workspace:*' },
});

const header = (id: string) =>
  `/**\n * ${id}: A member pays an invoice.\n * Contract: docs/a.md\n * Entry: the home page\n * Isolation and cleanup: a unique invoice\n */\n`;

/** The import that every web journey has: `test` from the journey kit. */
const kit = "import { test } from '@repo/journeys/testing/test';\n";

const flow = (id: string, platform = 'web') => ({
  platform,
  commands: [['mise', 'exec', '--', 'bun', 'run', 'journey', id]],
});

test('a shipped feature with a registered journey for each platform passes', async () => {
  expect(
    await inRepo(
      {
        'apps/app/package.json': app(['billing']),
        'apps/mobile/package.json': nativeApp,
        'features/billing/screens/billing-screen.tsx': '',
        'features/billing/journeys/pay-invoice.pw.ts': `${header('pay-invoice')}${kit}`,
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
        'apps/app/package.json': app(['billing', 'notes']),
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
    'features/notes/journeys/notes-sync.pw.ts: it takes `test` from @playwright/test. Take `test` from @repo/journeys/testing/test, so the run is measured against its budgets. See docs/contributing/end-to-end-testing.md#measures.',
    'features/notes/journeys/notes-sync.pw.ts: the header has no `Contract:` line. Add it.',
    'features/notes/journeys/notes-sync.pw.ts: the header has no `Entry:` line. Add it.',
    'features/notes/journeys/notes-sync.pw.ts: the header has no `Isolation and cleanup:` line. Add it.',
    'features/notes/journeys/notes-sync.pw.ts: the header starts with `notes-sync: <user goal>`. Write the goal on the first header line.',
  ]);
});

test('a universal app ships its features on native and on web, so each needs both journeys', async () => {
  expect(
    await inRepo(
      {
        'apps/app/package.json': app(['billing'], {
          dependencies: { expo: '~57.0.30' },
          scripts: { 'build:web': 'one build' },
        }),
        'features/billing/screens/billing-screen.tsx': '',
        'features/billing/journeys/pay-invoice.pw.ts': `${header('pay-invoice')}${kit}`,
        [verificationFile]: JSON.stringify({
          flows: { 'pay-invoice': flow('pay-invoice') },
        }),
      },
      checkJourneys,
    ),
  ).toEqual([
    'features/billing: the native app ships it, but it has no native journey. Add features/billing/journeys/<id>.maestro.yaml with the spec header from .agents/skills/setup-verification/references/journey-specification.md.',
  ]);
});

test('a web journey that takes test from @playwright/test in any form, or not from the kit, fails', async () => {
  const measured = [
    "import { expect } from '@playwright/test';",
    "import type { Page } from '@playwright/test';",
    "import type * as types from '@playwright/test';",
    "import { test } from '@repo/journeys/testing/test';",
  ].join('\n');
  const journeys = {
    'pay-invoice': measured,
    renamed: "import { test as journey } from '@repo/journeys/testing/test';",
    named: "import { expect, test as base } from '@playwright/test';",
    'default-import': "import test from '@playwright/test';",
    'default-and-kit': `import pw from '@playwright/test';\n${kit}`,
    namespace: "import * as pw from '@playwright/test';",
    'no-kit': "import { expect } from '@playwright/test';",
    'type-only-kit': "import type { test } from '@repo/journeys/testing/test';",
  };
  const files = {
    ...Object.fromEntries(
      Object.entries(journeys).map(([id, body]) => [
        `features/billing/journeys/${id}.pw.ts`,
        `${header(id)}${body}\n`,
      ]),
    ),
    [verificationFile]: JSON.stringify({
      flows: Object.fromEntries(Object.keys(journeys).map((id) => [id, flow(id)])),
    }),
  };
  const fix =
    'Take `test` from @repo/journeys/testing/test, so the run is measured against its budgets. See docs/contributing/end-to-end-testing.md#measures.';
  const at = (id: string, why: string) => `features/billing/journeys/${id}.pw.ts: ${why} ${fix}`;
  const problems = await inRepo(files, checkJourneys);
  expect(problems.toSorted()).toEqual(
    [
      at('named', 'it takes `test` from @playwright/test.'),
      at('default-import', 'it takes the default export of @playwright/test, which is its `test`.'),
      at(
        'default-and-kit',
        'it takes the default export of @playwright/test, which is its `test`.',
      ),
      at('namespace', 'it takes all of @playwright/test as a namespace, which holds its `test`.'),
      at('no-kit', 'it does not take `test` from @repo/journeys/testing/test.'),
      at('type-only-kit', 'it does not take `test` from @repo/journeys/testing/test.'),
    ].toSorted(),
  );
});

test('the core journey list matches the headings of the catalog', () => {
  const catalog = readFileSync(
    path.join(import.meta.dir, '../docs/contributing/journeys/core.md'),
    'utf-8',
  );
  const names = [...catalog.matchAll(/^## .+ \(`([a-z-]+)`\)$/gmu)].map((match) => match[1]);
  expect(names).toEqual([...coreJourneys]);
});

/** A data journey: one file that imports `journey`, with its header and an optional extra header line. */
const dataJourney = (id: string, extra = '') =>
  `/**\n * ${id}: A member pays an invoice.\n * Contract: docs/a.md\n * Entry: the home page\n * Isolation and cleanup: a unique invoice\n${extra} */\nimport { journey } from '@repo/journeys/testing/journey';\nexport const pay = journey('pays', []);\n`;

test('a data journey is one file with a web flow, and a Core journey in data form fails', async () => {
  expect(
    await inRepo(
      {
        'apps/app/package.json': app(['billing'], {
          dependencies: { expo: '~57.0.30' },
          scripts: { 'build:web': 'one build' },
        }),
        'features/billing/screens/billing-screen.tsx': '',
        'features/billing/journeys/pay-invoice.journey.ts': dataJourney('pay-invoice'),
        'features/billing/journeys/pay-core.journey.ts': dataJourney(
          'pay-core',
          ' * Core: sign-in\n',
        ),
        [verificationFile]: JSON.stringify({
          flows: {
            'pay-invoice': flow('pay-invoice'),
            'pay-core': flow('pay-core'),
          },
        }),
      },
      checkJourneys,
    ),
  ).toEqual([
    'features/billing/journeys/pay-core.journey.ts: a `Core:` journey stays in the script form, since the core journey rules read the Playwright source. Write it as features/<feature>/journeys/<id>.pw.ts.',
  ]);
});
