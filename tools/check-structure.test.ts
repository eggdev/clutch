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

const unnamed = (route: string) =>
  `${route}: renders on the server, but tools/server-rendered-routes.yaml does not name it. Make it render in the browser, or add it to the list with the reason \`seen without the app\` or \`ready sooner\`. See docs/principles/single-page-app.md.`;
const spaFix =
  "Set `web: { defaultRenderMode: 'spa' }` as a string literal. See docs/principles/single-page-app.md.";
const unreadable = `apps/app/vite.config.ts: the check cannot read the default render mode. It reads one \`defaultRenderMode\` with a string literal value. ${spaFix}`;

test('a config that renders on the server by default fails each route that takes it, and names the config', async () => {
  expect(
    await inRepo(
      {
        'apps/app/package.json': oneApp,
        'apps/app/vite.config.ts': "one({ web: { defaultRenderMode: 'ssg' } })",
        'apps/app/app/index.tsx': '',
        'apps/app/app/notes+spa.tsx': '',
      },
      checkStructure,
    ),
  ).toEqual([
    unnamed('apps/app/app/index.tsx'),
    `apps/app/vite.config.ts: sets the default render mode to \`ssg\`, so each route without a mode renders on the server. ${spaFix}`,
  ]);
});

test('a comment cannot hide the real default render mode', async () => {
  const app = { 'apps/app/package.json': oneApp, 'apps/app/app/index.tsx': '' };
  const configs = [
    "one({ web: {\n  // was: defaultRenderMode: 'spa'\n  defaultRenderMode: 'ssr' } })",
    "one({ web: {\n  /* defaultRenderMode: 'spa' */\n  defaultRenderMode: 'ssr' } })",
  ];
  for (const config of configs) {
    expect(await inRepo({ ...app, 'apps/app/vite.config.ts': config }, checkStructure)).toEqual([
      unnamed('apps/app/app/index.tsx'),
      `apps/app/vite.config.ts: sets the default render mode to \`ssr\`, so each route without a mode renders on the server. ${spaFix}`,
    ]);
  }
  expect(
    await inRepo(
      {
        ...app,
        'apps/app/vite.config.ts':
          "const api = 'http://api'; // defaultRenderMode: 'ssr'\none({ web: { defaultRenderMode: 'spa' } })",
      },
      checkStructure,
    ),
  ).toEqual([]);
});

test('a default mode that is not one string literal names the config, and a route with its own mode is still checked', async () => {
  const app = {
    'apps/app/package.json': oneApp,
    'apps/app/app/index.tsx': '',
    'apps/app/app/blog+ssr.tsx': '',
  };
  const configs = [
    "const mode = 'spa';\none({ web: { defaultRenderMode: mode } })",
    "one({ web: { defaultRenderMode: 'spa' }, native: { defaultRenderMode: 'ssr' } })",
    'one({ web: {} })',
  ];
  for (const config of configs) {
    expect(await inRepo({ ...app, 'apps/app/vite.config.ts': config }, checkStructure)).toEqual([
      unnamed('apps/app/app/blog+ssr.tsx'),
      unreadable,
    ]);
  }
  expect(await inRepo(app, checkStructure)).toEqual([
    unnamed('apps/app/app/blog+ssr.tsx'),
    `apps/app/vite.config.ts: does not exist, so One renders each route on the server by default. Create it. ${spaFix}`,
  ]);
});

test('a route listed while the default mode cannot be read is not a stale entry', async () => {
  expect(
    await inRepo(
      {
        'apps/app/package.json': oneApp,
        'apps/app/vite.config.ts': 'one({ web: { defaultRenderMode: mode } })',
        'apps/app/app/index.tsx': '',
        'tools/server-rendered-routes.yaml':
          '- route: apps/app/app/index.tsx\n  reason: ready sooner\n',
      },
      checkStructure,
    ),
  ).toEqual([unreadable]);
});

test('the route files follow One: any middle part, only .ts and .tsx, no native files, and test files count', async () => {
  expect(
    await inRepo(
      {
        'apps/app/package.json': oneApp,
        'apps/app/vite.config.ts': spaConfig,
        'apps/app/app/routes.d.ts': '',
        'apps/app/app/+html.tsx': '',
        'apps/app/app/g+ssr.foo.tsx': '',
        'apps/app/app/h+ssr.test.tsx': '',
        'apps/app/app/i+ssr.js': '',
        'apps/app/app/f+ssr.native.tsx': '',
        'apps/app/app/f+ssr.ios.tsx': '',
        'apps/app/app/f+ssr.android.ts': '',
        'apps/app/app/api/hello+api.ts': '',
      },
      checkStructure,
    ),
  ).toEqual([unnamed('apps/app/app/g+ssr.foo.tsx'), unnamed('apps/app/app/h+ssr.test.tsx')]);
});

test('an app with One only in its dev dependencies is a One app', async () => {
  expect(
    await inRepo(
      {
        'apps/app/package.json': '{"devDependencies":{"one":"1.27.1"}}',
        'apps/app/vite.config.ts': spaConfig,
        'apps/app/app/blog+ssr.tsx': '',
      },
      checkStructure,
    ),
  ).toEqual([unnamed('apps/app/app/blog+ssr.tsx')]);
});

test('a list that is not valid YAML, a malformed entry and a duplicate entry fail without a crash', async () => {
  const app = {
    'apps/app/package.json': oneApp,
    'apps/app/vite.config.ts': spaConfig,
    'apps/app/app/_layout+ssg.tsx': '',
  };
  expect(
    await inRepo(
      {
        ...app,
        'tools/server-rendered-routes.yaml': '- route: [apps/app\n  reason: ready sooner\n',
      },
      checkStructure,
    ),
  ).toEqual([
    expect.stringMatching(
      /^tools\/server-rendered-routes\.yaml: not valid YAML \(line \d+\)\. Fix the syntax\./u,
    ),
  ]);
  expect(
    await inRepo(
      {
        ...app,
        'tools/server-rendered-routes.yaml': [
          '- route: apps/app/app/_layout+ssg.tsx',
          '  reason: ready sooner',
          '-',
          '- apps/app/app/_layout+ssg.tsx',
          '- reason: ready sooner',
          '- route: 7',
          '- route: apps/app/app/_layout+ssg.tsx',
          '  reason: ready sooner',
        ].join('\n'),
      },
      checkStructure,
    ),
  ).toEqual([
    'tools/server-rendered-routes.yaml: apps/app/app/_layout+ssg.tsx has 2 entries. Keep one entry for each route.',
    'tools/server-rendered-routes.yaml: entry 2 is not an entry. Write it as `- route: <file>` with a `reason:` line.',
    'tools/server-rendered-routes.yaml: entry 3 is not an entry. Write it as `- route: <file>` with a `reason:` line.',
    'tools/server-rendered-routes.yaml: entry 4 has no `route`. Give it the path of the route file.',
    'tools/server-rendered-routes.yaml: entry 5 has no `route`. Give it the path of the route file.',
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
