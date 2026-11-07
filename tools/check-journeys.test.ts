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
    'features/notes/journeys/notes-sync.pw.ts: it takes `test` from @playwright/test. Take it from @repo/journeys/testing/test, so the run is measured against its budgets. See docs/contributing/end-to-end-testing.md#measures.',
    'features/notes/journeys/notes-sync.pw.ts: the header has no `Contract:` line. Add it.',
    'features/notes/journeys/notes-sync.pw.ts: the header has no `Entry:` line. Add it.',
    'features/notes/journeys/notes-sync.pw.ts: the header has no `Isolation and cleanup:` line. Add it.',
    'features/notes/journeys/notes-sync.pw.ts: the header starts with `notes-sync: <user goal>`. Write the goal on the first header line.',
  ]);
});

test('a web journey that takes test from @playwright/test fails, and one that takes only expect and types passes', async () => {
  const measured = [
    "import { expect } from '@playwright/test';",
    "import type { Page } from '@playwright/test';",
    "import { test } from '@repo/journeys/testing/test';",
  ].join('\n');
  const files = {
    'features/billing/journeys/pay-invoice.pw.ts': `${header('pay-invoice')}${measured}\n`,
    'features/billing/journeys/refund.pw.ts': `${header('refund')}import { expect, test as base } from '@playwright/test';\n`,
    'features/billing/journeys/void.pw.ts': `${header('void')}import * as pw from '@playwright/test';\n`,
    [verificationFile]: JSON.stringify({
      flows: { 'pay-invoice': flow('pay-invoice'), refund: flow('refund'), void: flow('void') },
    }),
  };
  const fix =
    'it takes `test` from @playwright/test. Take it from @repo/journeys/testing/test, so the run is measured against its budgets. See docs/contributing/end-to-end-testing.md#measures.';
  expect(await inRepo(files, checkJourneys)).toEqual([
    `features/billing/journeys/refund.pw.ts: ${fix}`,
    `features/billing/journeys/void.pw.ts: ${fix}`,
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
