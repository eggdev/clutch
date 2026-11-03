import { expect, test } from 'bun:test';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';

import {
  designSystemExports,
  exportedNames,
  isExempt,
  replacement,
  repositoryOf,
} from '@tools/lint/component-policy.mjs';
import { countLines, ruleCode } from '@tools/lint/lint-counts';

const root = path.resolve(import.meta.dir, '../..');

/**
 * Only this plugin, so the test holds in a project whose `oxlint.config.ts`
 * has not turned the rule on yet.
 */
const config = JSON.stringify({
  plugins: [],
  jsPlugins: [
    { name: 'repo-components', specifier: path.join(import.meta.dir, 'component-policy.mjs') },
  ],
  rules: { 'repo-components/design-system-only': 'error' },
});

/** A design system with four components, in a fake repository. */
const designSystem = {
  'package.json': '{ "workspaces": ["apps/*", "packages/*"] }',
  'packages/design-system/ui/button.tsx':
    'export function Button() { return <button type="button" />; }',
  'packages/design-system/ui/text-field.tsx': 'export function TextField() { return <input />; }',
  'packages/design-system/ui/text.tsx': 'const Text = () => null;\nexport { Text };',
  'packages/design-system/ui/checkbox.native.tsx': 'export const Checkbox = () => null;',
};

/**
 * Lints the files of a fake repository that holds `designSystem`, and lists
 * `file element component` for each diagnostic of the rule.
 */
async function lint(
  files: Record<string, string>,
  env: Record<string, string> = {},
): Promise<Array<string>> {
  const directory = await mkdtemp(path.join(tmpdir(), 'component-rule-'));
  try {
    for (const [name, source] of Object.entries({
      ...designSystem,
      ...files,
      '.oxlintrc.json': config,
    })) {
      await mkdir(path.dirname(path.join(directory, name)), { recursive: true });
      await writeFile(path.join(directory, name), source);
    }
    const run = Bun.spawnSync(
      [
        path.resolve(root, 'node_modules/.bin/oxlint'),
        '-c',
        path.join(directory, '.oxlintrc.json'),
        '--format',
        'json',
        directory,
      ],
      { env: { ...process.env, ...env } },
    );
    const result = JSON.parse(run.stdout.toString());
    return result.diagnostics
      .filter((item: { code: string }) => item.code === 'repo-components(design-system-only)')
      .map((item: { filename: string; message: string }) => {
        const [element, component] = [...item.message.matchAll(/`([^`]+)`/gu)].map(
          (match) => match[1],
        );
        return `${path.relative(directory, path.resolve(item.filename))} ${element} ${component}`;
      })
      .toSorted();
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
}

test('exportedNames reads value exports and leaves type exports out', () => {
  expect([
    ...exportedNames(`
export function Button() {}
export const buttonVariants = cva('');
export { Text, TextClassContext as Context };
export type { TextProps };
export { type Ref, Switch };
const inner = 1;
`),
  ]).toEqual(['Button', 'buttonVariants', 'Text', 'Context', 'Switch']);
});

test('designSystemExports maps each component to its module, platform files too', async () => {
  const directory = await mkdtemp(path.join(tmpdir(), 'component-exports-'));
  try {
    for (const [name, source] of Object.entries(designSystem)) {
      await mkdir(path.dirname(path.join(directory, name)), { recursive: true });
      await writeFile(path.join(directory, name), source);
    }
    const exports = designSystemExports(directory);
    expect(exports.get('Button')).toBe('@repo/design-system/ui/button');
    expect(exports.get('Checkbox')).toBe('@repo/design-system/ui/checkbox');
    expect(exports.get('Text')).toBe('@repo/design-system/ui/text');
    expect(repositoryOf(path.join(directory, 'apps/app/screen.tsx'))).toBe(directory);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test('replacement names the first component that the design system exports', () => {
  const exports = new Map([
    ['IconButton', '@repo/design-system/ui/icon-button'],
    ['Input', '@repo/design-system/ui/input'],
  ]);
  expect(replacement(['Button', 'IconButton'], exports)).toEqual({
    name: 'IconButton',
    from: '@repo/design-system/ui/icon-button',
  });
  expect(replacement(['Textarea'], exports)).toBeNull();
  expect(replacement(undefined, exports)).toBeNull();
});

test('the design system and tests may render raw elements', () => {
  expect(isExempt('packages/design-system/ui/button.tsx')).toBe(true);
  expect(isExempt('apps/app/lib/command-palette.test.tsx')).toBe(true);
  expect(isExempt('features/notes/journeys/notes-sync.pw.ts')).toBe(true);
  expect(isExempt('packages/notes/testing/render.tsx')).toBe(true);
  expect(isExempt('apps/app/lib/command-palette.tsx')).toBe(false);
  expect(isExempt('packages/design-system-extra/ui/card.tsx')).toBe(false);
});

test('the rule flags wrapped web and React Native elements, and names the component', async () => {
  expect(
    await lint({
      'apps/app/screen.tsx': `
        import { Pressable as Tap, Text, View, ScrollView, TextInput } from 'react-native';
        import * as RN from 'react-native';
        export function Screen() {
          return (
            <View>
              <ScrollView />
              <button type="button">Save</button>
              <input name="title" />
              <input type="checkbox" />
              <textarea />
              <Tap />
              <RN.TouchableOpacity />
              <RN.View />
              <Text>Hello</Text>
              <TextInput />
            </View>
          );
        }
      `,
    }),
  ).toEqual([
    'apps/app/screen.tsx <RN.TouchableOpacity> Button',
    'apps/app/screen.tsx <Tap> Button',
    'apps/app/screen.tsx <Text> Text',
    'apps/app/screen.tsx <TextInput> TextField',
    'apps/app/screen.tsx <button> Button',
    'apps/app/screen.tsx <input> Checkbox',
    'apps/app/screen.tsx <input> TextField',
  ]);
});

test('the rule skips tests, the design system and elements that it does not wrap', async () => {
  expect(
    await lint({
      'apps/app/screen.test.tsx': 'export function Probe() { return <button type="button" />; }',
      'apps/app/layout.tsx': `
        import { View } from 'react-native';
        export function Layout() { return <View><div /><textarea /><select /></View>; }
      `,
    }),
  ).toEqual([]);
});

test('the rule skips the files that the ratchet counts, unless REPO_LINT_ALL is set', async () => {
  const files = {
    '.clutch/ratchets.json': JSON.stringify({
      schemaVersion: 1,
      ratchets: {
        'design-system-only': {
          command: 'bun tools/lint/lint-counts.ts repo-components/design-system-only',
          files: '**/*.tsx',
          counts: { 'apps/app/old.tsx': 1 },
        },
      },
    }),
    'apps/app/old.tsx': 'export function Old() { return <button type="button" />; }',
    'apps/app/new.tsx': 'export function New() { return <button type="button" />; }',
  };
  expect(await lint(files)).toEqual(['apps/app/new.tsx <button> Button']);
  expect(await lint(files, { REPO_LINT_ALL: '1' })).toEqual([
    'apps/app/new.tsx <button> Button',
    'apps/app/old.tsx <button> Button',
  ]);
});

test('lint-counts prints one path:count line for each file that breaks the rule', () => {
  expect(ruleCode('repo-components/design-system-only')).toBe(
    'repo-components(design-system-only)',
  );
  expect(
    countLines(
      [
        { code: 'repo-components(design-system-only)', filename: 'apps/b.tsx' },
        { code: 'repo-components(design-system-only)', filename: 'apps/a.tsx' },
        { code: 'repo-classes(no-dark-variant)', filename: 'apps/a.tsx' },
        { code: 'repo-components(design-system-only)', filename: 'apps/b.tsx' },
      ],
      'repo-components/design-system-only',
    ),
  ).toEqual(['apps/a.tsx:1', 'apps/b.tsx:2']);
});
