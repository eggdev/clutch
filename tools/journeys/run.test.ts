import { expect, test } from 'bun:test';
import path from 'node:path';

import { unprovenCore } from '@tools/journeys/core-proof';
import type { DeviceRun } from '@tools/journeys/measures';
import { main } from '@tools/journeys/run';
import type { Sink } from '@tools/journeys/run';
import { inRepo } from '@tools/testing/in-repo';

/** A web app: it depends on React, and it has a dev target. */
const app = JSON.stringify({
  dependencies: { react: '19.2.3' },
  nx: {
    tags: ['type:app'],
    targets: { dev: { executor: 'nx:run-commands', options: { command: 'one dev' } } },
  },
});

const journey = '/**\n * pay-invoice: A member pays an invoice.\n */\nexport {};\n';

/** A sink that keeps what the run writes, with the environment of a GitHub Actions run. */
function capture(env: Sink['env']) {
  const lines: Array<string> = [];
  const sink: Sink = {
    env,
    log: (line) => lines.push(line),
    error: (line) => lines.push(line),
  };
  return { sink, lines };
}

test('with no web journey, --all exits 0 and warns, and the step summary names the guide', async () => {
  await inRepo(
    { 'package.json': JSON.stringify({ name: 'shop' }), 'apps/app/package.json': app },
    async (root) => {
      const summary = path.join(root, 'summary.md');
      const { sink, lines } = capture({
        GITHUB_STEP_SUMMARY: summary,
        GITHUB_REPOSITORY: 'eggdev/neighborhood',
        GITHUB_SHA: 'abc123',
      });
      expect(await main(root, '--all', sink)).toBe(0);
      const link =
        'https://github.com/eggdev/neighborhood/blob/abc123/docs/contributing/end-to-end-testing.md';
      expect(lines).toEqual([
        'No web journey exists yet. Nothing ran.',
        `::warning title=No journey ran::No web journey exists yet, so this check tested nothing. Add one at features/<feature>/journeys/<id>.pw.ts. See ${link}`,
      ]);
      expect(await Bun.file(summary).text()).toContain(
        `Add a web journey at \`features/<feature>/journeys/<id>.pw.ts\`. See [end-to-end testing](${link}).`,
      );
    },
  );
});

test('production with no URL fails', async () => {
  await inRepo({ 'package.json': JSON.stringify({ name: 'shop' }) }, async (root) => {
    const { sink, lines } = capture({});
    expect(await main(root, '--production', sink)).toBe(1);
    expect(lines.join('\n')).toContain('needs the URL');
  });
});

test('production with no core journey fails, since it has no proof', async () => {
  await inRepo(
    { 'package.json': JSON.stringify({ name: 'shop' }), 'apps/web/package.json': app },
    async (root) => {
      const { sink, lines } = capture({});
      expect(await main(root, '--production', sink, 'https://x.test')).toBe(1);
      expect(lines.join('\n')).toContain('No core journey exists');
    },
  );
});

test('--hunt with no whole number of runs fails, and names the form', async () => {
  await inRepo(
    {
      'package.json': JSON.stringify({ name: 'shop' }),
      'features/billing/journeys/pay-invoice.pw.ts': journey,
    },
    async (root) => {
      const { sink, lines } = capture({});
      expect(await main(root, '--hunt', sink, undefined, Number.NaN)).toBe(1);
      expect(lines.join('\n')).toContain('`--hunt 20`');
    },
  );
});

test('no journey ran while a feature ships a screen fails, and names the feature', async () => {
  await inRepo(
    {
      'package.json': JSON.stringify({ name: 'shop' }),
      'apps/web/package.json': JSON.stringify({
        name: 'web',
        dependencies: { '@features/billing': 'workspace:*', react: '19.2.3' },
      }),
      'features/billing/package.json': JSON.stringify({ name: '@features/billing' }),
      'features/billing/screens/pay.tsx': 'export const Pay = 1;\n',
    },
    async (root) => {
      const { sink, lines } = capture({});
      expect(await main(root, '--all', sink)).toBe(1);
      expect(lines.join('\n')).toContain('features/billing');
    },
  );
});

test('a native feature with its native journey and no web journey still exits 0', async () => {
  await inRepo(
    {
      'package.json': JSON.stringify({ name: 'shop' }),
      'apps/mobile/package.json': JSON.stringify({
        name: 'mobile',
        dependencies: { '@features/billing': 'workspace:*', 'react-native': '0.86.3' },
      }),
      'features/billing/package.json': JSON.stringify({ name: '@features/billing' }),
      'features/billing/screens/pay.tsx': 'export const Pay = 1;\n',
      'features/billing/journeys/pay.maestro.yaml': 'appId: x\n---\n- launchApp\n',
    },
    async (root) => {
      const { sink } = capture({});
      expect(await main(root, '--all', sink)).toBe(0);
    },
  );
});

test('several web apps and no journeys.webApp fail before any server starts', async () => {
  await inRepo(
    {
      'package.json': JSON.stringify({ name: 'shop' }),
      'apps/web/package.json': app,
      'apps/admin/package.json': app,
      'features/billing/journeys/pay-invoice.pw.ts': journey,
    },
    async (root) => {
      const { sink, lines } = capture({});
      expect(await main(root, '--all', sink)).toBe(1);
      expect(lines).toEqual([
        'Several apps under apps/ have a web entry: apps/admin, apps/web. Name the app that the web journeys drive in clutch.yaml with `journeys: { webApp: apps/<name> }`.',
      ]);
    },
  );
});

/** The repository that holds this test, for the real Playwright binary and the real journeys config. */
const repo = path.resolve(import.meta.dirname, '../..');

test('a journey that fails its first run fails the run on each device, with no retry', async () => {
  // The real journeys config, with only its folders and its reporter moved to a scratch folder.
  const config = [
    "import path from 'node:path';",
    `import config from '${repo}/tools/journeys/playwright.config.ts';`,
    'const here = import.meta.dirname;',
    "export default { ...config, testDir: here, testMatch: ['*.pw.ts'], outputDir: path.join(here, 'out'),",
    "  reporter: [['json', { outputFile: path.join(here, 'report.json') }]] };",
  ].join('\n');
  // It fails on its first run, and passes on any later run.
  const journeyFile = [
    `import { expect, test } from '${repo}/node_modules/@playwright/test/index.mjs';`,
    "test('passes only on a retry', ({}, info) => {",
    '  expect(info.retry).toBeGreaterThan(0);',
    '});',
  ].join('\n');
  await inRepo(
    {
      'package.json': JSON.stringify({ type: 'module' }),
      'config.ts': config,
      'once.pw.ts': journeyFile,
    },
    async (root) => {
      const run = Bun.spawn(
        [path.join(repo, 'node_modules/.bin/playwright'), 'test', '--config', 'config.ts'],
        { cwd: root, stdout: 'ignore', stderr: 'ignore' },
      );
      expect(await run.exited).toBe(1);
      const report = (await Bun.file(path.join(root, 'report.json')).json()) as {
        suites: Array<{ specs: Array<{ tests: Array<{ results: Array<{ status: string }> }> }> }>;
      };
      const runs = report.suites.flatMap((suite) =>
        suite.specs.flatMap((spec) =>
          spec.tests.map((item) => item.results.map((result) => result.status)),
        ),
      );
      expect(runs).toEqual([['failed'], ['failed'], ['failed']]);
    },
  );
});

const signInJourney = {
  id: 'sign-in',
  feature: 'account',
  file: 'features/account/journeys/sign-in.pw.ts',
  platform: 'web' as const,
};

/** A passed run on `device`, with one try for each list of outcome names. */
const run = (device: string, ...tries: Array<Array<string>>): DeviceRun => ({
  platform: 'web',
  device,
  result: 'passed',
  attempts: tries.map((names, retry) => ({
    device,
    retry,
    status: 'passed',
    durationMs: 1000,
    outcomes: names.map((name) => ({ name })),
  })),
});

test('a passed core journey run that did not record each catalog outcome, signed-up first, on each device, is unproven', async () => {
  const signIn = '/**\n * sign-in: A visitor signs in.\n * Core: sign-in\n */\nexport {};\n';
  await inRepo({ 'features/account/journeys/sign-in.pw.ts': signIn }, (root) => {
    const proven = [
      'signed-up',
      'signed-out',
      'wrong-password-refused',
      'signed-in',
      'session-kept',
    ];
    const at = 'features/account/journeys/sign-in.pw.ts on Desktop';
    // The phone proves each outcome on its retry. The desktop never records signed-up first.
    expect(
      unprovenCore(root, [signInJourney], () => [
        run('Phone', ['signed-up'], proven),
        run('Tablet', proven),
        run('Desktop', ['signed-in', 'signed-up', 'signed-out']),
      ]),
    ).toEqual([
      `${at}: the run did not record \`signed-up\` first, so it did not prove a new account. See docs/contributing/journeys/core.md.`,
      `${at}: the run passed, but recorded no \`session-kept\`, \`wrong-password-refused\`. Each catalog outcome must hold in the run. See docs/contributing/journeys/core.md.`,
    ]);
    expect(
      unprovenCore(root, [signInJourney], () => [
        run('Phone', proven),
        run('Tablet', proven),
        run('Desktop', proven),
      ]),
    ).toEqual([]);
    // A device with no run proves nothing: the tablet and the desktop each fail twice.
    expect(unprovenCore(root, [signInJourney], () => [run('Phone', proven)])).toHaveLength(4);
  });
});
