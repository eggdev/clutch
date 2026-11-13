import { expect, test } from 'bun:test';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { isExempt, readsWidth } from '@tools/lint/layout-policy.mjs';

const root = path.resolve(import.meta.dir, '../..');

/** The app shell of the scratch repository: the root layout of its app. */
const shell = 'apps/app/app/_layout+ssg.tsx';

/**
 * Lints files in a scratch repository with only this plugin, so the test
 * holds in a project whose `oxlint.config.ts` has not turned the rule on yet.
 * Lists `file line` for each finding of the rule.
 */
async function lint(
  files: Record<string, string>,
  env: Record<string, string> = {},
): Promise<Array<string>> {
  const directory = await mkdtemp(path.join(tmpdir(), 'layout-rule-'));
  try {
    for (const [name, source] of Object.entries({
      'package.json': '{ "workspaces": ["apps/*", "features/*", "packages/*"] }',
      ...files,
    })) {
      await mkdir(path.dirname(path.join(directory, name)), { recursive: true });
      await writeFile(path.join(directory, name), source);
    }
    await writeFile(
      path.join(directory, 'oxlint.json'),
      JSON.stringify({
        plugins: [],
        jsPlugins: [
          { name: 'repo-layout', specifier: path.resolve(root, 'tools/lint/layout-policy.mjs') },
        ],
        rules: { 'repo-layout/no-viewport-reads': ['error', { shell: [shell] }] },
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
      .filter((item: { code: string }) => item.code === 'repo-layout(no-viewport-reads)')
      .map(
        (item: { filename: string; labels: Array<{ span: { line: number } }> }) =>
          `${item.filename} ${item.labels[0]?.span.line}`,
      )
      .toSorted();
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
}

/** One window width read on each line. */
const widthReads = [
  'export const a = window.innerWidth;',
  'export const b = innerWidth;',
  "export const c = globalThis['outerWidth'];",
  'export const { innerWidth: d } = self;',
  "export const e = matchMedia('(min-width: 48rem)').matches;",
  'export const f = window.matchMedia(`(max-width: 600px)`);',
  "export const g = matchMedia('(width >= 600px)');",
  'export const h = window.screen.width;',
  'export const i = screen.availWidth;',
].join('\n');

test('each window width read fails in a component', async () => {
  expect(await lint({ 'features/notes/ui/card.tsx': widthReads })).toEqual(
    Array.from({ length: 9 }, (_, index) => `features/notes/ui/card.tsx ${index + 1}`),
  );
});

test('useWindowDimensions and Dimensions.get from React Native fail', async () => {
  expect(
    await lint({
      'packages/notes/ui/list.tsx': [
        "import { Dimensions, useWindowDimensions as useSize } from 'react-native';",
        "import * as RN from 'react-native';",
        'export function List() {',
        '  const { width } = useSize();',
        '  const narrow = RN.useWindowDimensions().width < 600;',
        "  return [width, narrow, Dimensions.get('window').width, RN.Dimensions.get('screen')];",
        '}',
      ].join('\n'),
    }),
  ).toEqual([
    'packages/notes/ui/list.tsx 4',
    'packages/notes/ui/list.tsx 5',
    'packages/notes/ui/list.tsx 6',
    'packages/notes/ui/list.tsx 6',
  ]);
});

test('a query that lint cannot read fails', async () => {
  expect(
    await lint({
      'features/notes/ui/query.tsx': [
        'declare const query: string;',
        'export const a = matchMedia(query);',
        `export const b = window.matchMedia(\`(min-width: \${query})\`);`,
        'export const { matchMedia: media } = window;',
      ].join('\n'),
    }),
  ).toEqual([
    'features/notes/ui/query.tsx 2',
    'features/notes/ui/query.tsx 3',
    'features/notes/ui/query.tsx 4',
  ]);
});

test('the app shell, tests and testing helpers pass', async () => {
  expect(
    await lint({
      [shell]: widthReads,
      'features/notes/ui/card.test.tsx': widthReads,
      'packages/journeys/testing/screen.ts': widthReads,
      'apps/app/app/notes.tsx': 'export const a = window.innerWidth;',
    }),
  ).toEqual(['apps/app/app/notes.tsx 1']);
});

test('queries that do not read the width, local names and other fields pass', async () => {
  expect(
    await lint({
      'features/notes/ui/motion.tsx': [
        "export const a = matchMedia('(prefers-reduced-motion: reduce)').matches;",
        "export const b = window.matchMedia('(prefers-color-scheme: dark)');",
        "export const c = matchMedia('(hover: hover) and (pointer: fine)');",
        'export function size(innerWidth: number, screen: { width: number }) {',
        '  return innerWidth + screen.width;',
        '}',
        'export const d = window.scrollY + window.innerHeight;',
        "export const e = typeof window === 'undefined';",
        "export const f = 'window.innerWidth';",
        "import { useWindowDimensions } from './sizes';",
        'export const g = useWindowDimensions();',
        "import type { ScaledSize } from 'react-native';",
        'export type Size = ScaledSize;',
      ].join('\n'),
      'features/notes/ui/sizes.ts': 'export const useWindowDimensions = () => 0;',
    }),
  ).toEqual([]);
});

test('the rule skips the files that the ratchet counts, unless REPO_LINT_ALL is set', async () => {
  const read = 'export const width = window.innerWidth;';
  const files = {
    '.clutch/ratchets.json': JSON.stringify({
      schemaVersion: 1,
      ratchets: {
        'no-viewport-reads': {
          command: 'bun tools/lint/lint-counts.ts repo-layout/no-viewport-reads',
          files: '{apps,features,packages}/**/*.{ts,tsx}',
          counts: { 'features/notes/ui/old.tsx': 1 },
        },
      },
    }),
    'features/notes/ui/old.tsx': read,
    'features/notes/ui/new.tsx': read,
  };
  expect(await lint(files)).toEqual(['features/notes/ui/new.tsx 1']);
  expect(await lint(files, { REPO_LINT_ALL: '1' })).toEqual([
    'features/notes/ui/new.tsx 1',
    'features/notes/ui/old.tsx 1',
  ]);
});

test('readsWidth finds each width feature and no other feature', () => {
  expect(
    [
      '(min-width: 48rem)',
      '(max-width: 600px)',
      '(width >= 600px)',
      '(400px <= width <= 700px)',
      'screen and (min-device-width: 320px)',
      '(prefers-reduced-motion)',
      '(prefers-color-scheme: dark)',
      '(min-height: 600px)',
      '(orientation: portrait)',
      '(min-resolution: 2dppx)',
    ].map((query) => [query, readsWidth(query)]),
  ).toEqual([
    ['(min-width: 48rem)', true],
    ['(max-width: 600px)', true],
    ['(width >= 600px)', true],
    ['(400px <= width <= 700px)', true],
    ['screen and (min-device-width: 320px)', true],
    ['(prefers-reduced-motion)', false],
    ['(prefers-color-scheme: dark)', false],
    ['(min-height: 600px)', false],
    ['(orientation: portrait)', false],
    ['(min-resolution: 2dppx)', false],
  ]);
});

test('isExempt holds tests and testing helpers only', () => {
  expect(
    [
      'features/notes/ui/card.test.tsx',
      'apps/app/e2e/notes.pw.ts',
      'packages/journeys/testing/screen.ts',
      'features/notes/ui/card.tsx',
      'apps/app/app/notes.tsx',
    ].map((file) => [file, isExempt(file)]),
  ).toEqual([
    ['features/notes/ui/card.test.tsx', true],
    ['apps/app/e2e/notes.pw.ts', true],
    ['packages/journeys/testing/screen.ts', true],
    ['features/notes/ui/card.tsx', false],
    ['apps/app/app/notes.tsx', false],
  ]);
});
