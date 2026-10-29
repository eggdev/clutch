import { expect, test } from 'bun:test';

import { checkStructure } from '@tools/check-structure';
import { inRepo } from '@tools/testing/in-repo';

const manifest = '{}';

test('a package with only sections and config files, and a feature with its gate, pass', async () => {
  expect(
    await inRepo(
      {
        'packages/billing/package.json': manifest,
        'packages/billing/README.md': '# Billing\n',
        'packages/billing/drizzle.config.ts': '',
        'packages/billing/types/invoice.ts': '',
        'packages/billing/repo/migrations/.gitkeep': '',
        'packages/billing/testing/.gitkeep': '',
        'features/billing/package.json': manifest,
        'features/billing/tsconfig.json': '{}',
        'features/billing/gate.ts': '',
        'features/billing/screens/billing-screen.tsx': '',
        'features/billing/components/.gitkeep': '',
      },
      checkStructure,
    ),
  ).toEqual([]);
});

test('a folder that is not a section, a loose file, and a feature without its gate fail', async () => {
  expect(
    await inRepo(
      {
        'packages/billing/package.json': manifest,
        'packages/billing/lib/money.ts': '',
        'packages/billing/src/server.ts': '',
        'packages/billing/index.ts': '',
        'features/billing/package.json': manifest,
        'features/billing/hooks/use-plan.ts': '',
        'features/billing/utils.ts': '',
        'features/billing/screens/billing-screen.tsx': '',
      },
      checkStructure,
    ),
  ).toEqual([
    'features/billing/hooks/: a feature has only `gate.ts`, `screens/` and `components/`. Move shared code into a package.',
    'features/billing/utils.ts: a feature has only `gate.ts`, `screens/` and `components/`. Move shared code into a package.',
    'features/billing: has no `gate.ts`. Each feature has one gate. See docs/principles/one-gate-per-feature.md.',
    'packages/billing/index.ts: a package keeps code in sections. Move the file into the section that owns it.',
    'packages/billing/lib/: not a section. Move the code into one of: types, config, models, commands, repo, service, jobs, runtime, ui, testing.',
    'packages/billing/src/: not a section. Move the code into one of: types, config, models, commands, repo, service, jobs, runtime, ui, testing.',
  ]);
});

test('a folder without a package.json is not a project, so the check skips it', async () => {
  expect(await inRepo({ 'packages/notes-old/lib/x.ts': '' }, checkStructure)).toEqual([]);
});
