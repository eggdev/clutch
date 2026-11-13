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
        'packages/billing/AGENTS.md': '# Billing agent rules\n',
        'packages/billing/CLAUDE.md': '@AGENTS.md\n',
        'packages/billing/drizzle.config.ts': '',
        'packages/billing/types/invoice.ts': '',
        'packages/billing/repo/migrations/.gitkeep': '',
        'packages/billing/testing/.gitkeep': '',
        'features/billing/package.json': manifest,
        'features/billing/tsconfig.json': '{}',
        'features/billing/gate.ts': '',
        'features/billing/screens/billing-screen.tsx': '',
        'features/billing/components/.gitkeep': '',
        'features/billing/journeys/billing-open.pw.ts': '',
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
    'features/billing/hooks/: a feature has only `gate.ts`, `screens/`, `components/` and `journeys/`. Move shared code into a package.',
    'features/billing/utils.ts: a feature has only `gate.ts`, `screens/`, `components/` and `journeys/`. Move shared code into a package.',
    'features/billing: has no `gate.ts`. Each feature has one gate. See docs/principles/one-gate-per-feature.md.',
    'packages/billing/index.ts: a package keeps code in sections. Move the file into the section that owns it.',
    'packages/billing/lib/: not a section. Move the code into one of: types, config, contract, commands, repo, service, jobs, runtime, ui, testing.',
    'packages/billing/src/: not a section. Move the code into one of: types, config, contract, commands, repo, service, jobs, runtime, ui, testing.',
  ]);
});

test('a folder without a package.json is not a project, so the check skips it', async () => {
  expect(await inRepo({ 'packages/notes-old/lib/x.ts': '' }, checkStructure)).toEqual([]);
});

const oneApp = '{"dependencies":{"one":"1.27.1"}}';
const spaConfig = "one({ web: { defaultRenderMode: 'spa' } })";

test('a server render that the list names with a true reason passes', async () => {
  expect(
    await inRepo(
      {
        'apps/app/package.json': oneApp,
        'apps/app/vite.config.ts': spaConfig,
        'apps/app/app/_layout+ssg.tsx': '',
        'apps/app/app/index.tsx': '',
        'apps/app/app/shared/[token]+ssr.tsx': '',
        'apps/app/app/api/hello+api.ts': '',
        'tools/server-rendered-routes.yaml': [
          '- route: apps/app/app/_layout+ssg.tsx',
          '  reason: ready sooner',
          '- route: apps/app/app/shared/[token]+ssr.tsx',
          '  reason: seen without the app',
        ].join('\n'),
      },
      checkStructure,
    ),
  ).toEqual([]);
});

test('a server render that the list does not name fails, and the message names the route', async () => {
  expect(
    await inRepo(
      {
        'apps/app/package.json': oneApp,
        'apps/app/vite.config.ts': spaConfig,
        'apps/app/app/pricing+ssg.web.tsx': '',
        'apps/app/app/blog+ssr/index.tsx': '',
        'apps/app/app/blog+ssr/post+spa.tsx': '',
      },
      checkStructure,
    ),
  ).toEqual([
    'apps/app/app/blog+ssr/index.tsx: renders on the server, but tools/server-rendered-routes.yaml does not name it. Make it render in the browser, or add it to the list with the reason `seen without the app` or `ready sooner`. See docs/principles/single-page-app.md.',
    'apps/app/app/pricing+ssg.web.tsx: renders on the server, but tools/server-rendered-routes.yaml does not name it. Make it render in the browser, or add it to the list with the reason `seen without the app` or `ready sooner`. See docs/principles/single-page-app.md.',
  ]);
});

test('a One app whose config does not render in the browser by default renders each route on the server', async () => {
  expect(
    await inRepo({ 'apps/app/package.json': oneApp, 'apps/app/app/index.tsx': '' }, checkStructure),
  ).toEqual([
    'apps/app/app/index.tsx: renders on the server, but tools/server-rendered-routes.yaml does not name it. Make it render in the browser, or add it to the list with the reason `seen without the app` or `ready sooner`. See docs/principles/single-page-app.md.',
  ]);
});

test('an entry with another reason, a stale entry and a list that is not a list fail', async () => {
  const app = {
    'apps/app/package.json': oneApp,
    'apps/app/vite.config.ts': spaConfig,
    'apps/app/app/_layout+ssg.tsx': '',
    'apps/app/app/notes.tsx': '',
  };
  expect(
    await inRepo(
      {
        ...app,
        'tools/server-rendered-routes.yaml': [
          '- route: apps/app/app/_layout+ssg.tsx',
          '  reason: it is faster',
          '- route: apps/app/app/notes.tsx',
          '  reason: ready sooner',
          '- route: apps/app/app/gone+ssr.tsx',
          '  reason: seen without the app',
        ].join('\n'),
      },
      checkStructure,
    ),
  ).toEqual([
    'tools/server-rendered-routes.yaml: apps/app/app/_layout+ssg.tsx has the reason `it is faster`. Give it `seen without the app` or `ready sooner`. See docs/principles/single-page-app.md.',
    'tools/server-rendered-routes.yaml: apps/app/app/gone+ssr.tsx is not a route that renders on the server. Delete its entry.',
    'tools/server-rendered-routes.yaml: apps/app/app/notes.tsx is not a route that renders on the server. Delete its entry.',
  ]);
  expect(
    await inRepo(
      { ...app, 'tools/server-rendered-routes.yaml': 'route: apps/app/app/_layout+ssg.tsx\n' },
      checkStructure,
    ),
  ).toEqual([
    'tools/server-rendered-routes.yaml: not a list. Write one `- route:` entry for each route.',
  ]);
});

test('an app that does not use One has no routes to check', async () => {
  expect(
    await inRepo(
      { 'apps/api/package.json': manifest, 'apps/api/app/server+ssr.ts': '' },
      checkStructure,
    ),
  ).toEqual([]);
});
