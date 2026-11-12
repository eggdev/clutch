import { expect, test } from 'bun:test';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { isClientApp } from '@tools/apps';
import type { Manifest } from '@tools/apps';
import { isClientManifest } from '@tools/lint/determinism-policy.mjs';

const root = path.resolve(import.meta.dir, '../..');

/**
 * Each row is a package.json, and both rules must answer the same for it: the
 * plugin's `isClientManifest` and `isClientApp` of tools/apps.ts. The last
 * three rows are the shapes where two copies of the rule once differed.
 */
const agreeing: Array<Manifest> = [
  { dependencies: { react: '19.2.3' } },
  { dependencies: { 'react-native': '0.86.3' } },
  { dependencies: { expo: '~57.0.30', react: '19.2.3' } },
  { dependencies: { effect: '4.0.7' } },
  { devDependencies: { react: '19.2.3' } },
  {},
  { dependencies: { expo: '~57.0.30' } },
  { nx: { tags: ['platform:native'] } },
  { dependencies: { react: '19.2.3' }, nx: { tags: ['platform:server'] } },
];

test('the lint plugin and the shared rule agree on each client-app manifest', () => {
  for (const manifest of agreeing) {
    expect({ manifest, plugin: isClientManifest(manifest) }).toEqual({
      manifest,
      plugin: isClientApp(manifest),
    });
  }
});
const serverApp = JSON.stringify({ nx: { tags: ['platform:server'] } });
const webApp = JSON.stringify({ dependencies: { react: '19.0.0' } });
const commandLineApp = JSON.stringify({ dependencies: { yaml: '2.0.0' } });

/** Lints files in a scratch project, and lists `file rule` for each finding. */
async function lint(
  files: Record<string, string>,
  env: Record<string, string> = {},
): Promise<Array<string>> {
  const directory = await mkdtemp(path.join(tmpdir(), 'determinism-rule-'));
  try {
    for (const [name, source] of Object.entries(files)) {
      await mkdir(path.dirname(path.join(directory, name)), { recursive: true });
      await writeFile(path.join(directory, name), source);
    }
    await writeFile(
      path.join(directory, 'oxlint.json'),
      JSON.stringify({
        jsPlugins: [
          {
            name: 'repo-determinism',
            specifier: path.resolve(root, 'tools/lint/determinism-policy.mjs'),
          },
        ],
        rules: { 'repo-determinism/no-ambient-time': 'error' },
      }),
    );
    const run = Bun.spawnSync(
      [
        path.resolve(root, 'node_modules/.bin/oxlint'),
        '-c',
        'oxlint.json',
        '--format',
        'json',
        '.',
      ],
      { cwd: directory, env: { ...process.env, REPO_LINT_ALL: undefined, ...env } },
    );
    const result = JSON.parse(run.stdout.toString());
    return result.diagnostics
      .filter((item: { code: string }) => item.code === 'repo-determinism(no-ambient-time)')
      .map((item: { filename: string }) => `${item.filename} no-ambient-time`)
      .toSorted();
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
}

const sixForms = [
  'export const a = Date.now();',
  'export const b = new Date();',
  'export const c = Math.random();',
  'export const d = crypto.randomUUID();',
  'export const e = crypto.getRandomValues(new Uint32Array(1));',
  'export const f = performance.now();',
].join('\n');

test('each of the six forbidden forms fails in a feature screen', async () => {
  expect(await lint({ 'features/notes/screens/x.tsx': sixForms })).toEqual(
    Array.from({ length: 6 }, () => 'features/notes/screens/x.tsx no-ambient-time'),
  );
});

test('the clock and random IDs fail in commands, contract and ui, and in apps that are not servers', async () => {
  const clock = 'export const at = Date.now();';
  expect(
    await lint({
      'packages/notes/commands/rename-note.ts': clock,
      'packages/notes/contract/notes.ts': clock,
      'packages/notes/ui/use-notes.ts': clock,
      'apps/web/package.json': webApp,
      'apps/web/src/main.tsx': clock,
    }),
  ).toEqual([
    'apps/web/src/main.tsx no-ambient-time',
    'packages/notes/commands/rename-note.ts no-ambient-time',
    'packages/notes/contract/notes.ts no-ambient-time',
    'packages/notes/ui/use-notes.ts no-ambient-time',
  ]);
});

test('the global objects and bracket access fail too', async () => {
  expect(
    await lint({
      'features/notes/screens/globals.tsx': [
        'export const a = globalThis.crypto.randomUUID();',
        'export const b = window.crypto.randomUUID();',
        'export const c = self.crypto.getRandomValues(new Uint8Array(4));',
        "export const d = Date['now']();",
        "export const e = performance['now']();",
        "export const f = Math['random']();",
      ].join('\n'),
    }),
  ).toEqual(Array.from({ length: 6 }, () => 'features/notes/screens/globals.tsx no-ambient-time'));
});

test('the server, the pool, tests, testing helpers and server apps pass', async () => {
  expect(
    await lint({
      'packages/notes/commands/rename-note.server.ts': sixForms,
      'packages/notes/service/notes.ts': sixForms,
      'packages/sync/runtime/pool.ts': sixForms,
      'packages/notes/commands/rename-note.test.ts': sixForms,
      'packages/notes/testing/x.ts': sixForms,
      'apps/api/package.json': serverApp,
      'apps/api/src/main.ts': sixForms,
      'apps/cli/package.json': commandLineApp,
      'apps/cli/src/main.ts': sixForms,
    }),
  ).toEqual([]);
});

test('a date with an argument, a string that names a call, and a comment pass', async () => {
  expect(
    await lint({
      'features/notes/screens/dates.tsx': [
        'declare const value: number;',
        'export const at = new Date(value);',
        "export const day = new Date('2026-01-01');",
        "export const text = 'Math.random() and Date.now()';",
        '// crypto.randomUUID() is only a comment here.',
      ].join('\n'),
    }),
  ).toEqual([]);
});

test('the rule skips the files that the ratchet counts, unless REPO_LINT_ALL is set', async () => {
  const clock = 'export const at = Date.now();';
  const files = {
    '.clutch/ratchets.json': JSON.stringify({
      schemaVersion: 1,
      ratchets: {
        'no-ambient-time': {
          command: 'bun tools/lint/lint-counts.ts repo-determinism/no-ambient-time',
          files: '{apps,features,packages}/**/*.{ts,tsx}',
          counts: { 'features/notes/screens/old.tsx': 1 },
        },
      },
    }),
    'features/notes/screens/old.tsx': clock,
    'features/notes/screens/new.tsx': clock,
  };
  expect(await lint(files)).toEqual(['features/notes/screens/new.tsx no-ambient-time']);
  expect(await lint(files, { REPO_LINT_ALL: '1' })).toEqual([
    'features/notes/screens/new.tsx no-ambient-time',
    'features/notes/screens/old.tsx no-ambient-time',
  ]);
});
