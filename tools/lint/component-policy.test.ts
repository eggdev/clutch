import { expect, test } from 'bun:test';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';

import {
  designSystemExports,
  exportedNames,
  isExempt,
  ratchetedFiles,
  replacement,
} from '@tools/lint/component-policy.mjs';
import { countLines, ruleCode } from '@tools/lint/lint-counts';

const root = path.resolve(import.meta.dir, '../..');

/** Lints TSX files in a temporary folder and lists `file element component` for each diagnostic. */
async function lint(files: Record<string, string>): Promise<Array<string>> {
  const directory = await mkdtemp(path.join(tmpdir(), 'component-rule-'));
  try {
    for (const [name, source] of Object.entries(files)) {
      await writeFile(path.join(directory, name), source);
    }
    const run = Bun.spawnSync([
      path.resolve(root, 'node_modules/.bin/oxlint'),
      '-c',
      path.resolve(root, 'oxlint.config.ts'),
      '--format',
      'json',
      directory,
    ]);
    const result = JSON.parse(run.stdout.toString());
    return result.diagnostics
      .filter((item: { code: string }) => item.code === 'repo-components(design-system-only)')
      .map((item: { filename: string; message: string }) => {
        const [element, component] = [...item.message.matchAll(/`([^`]+)`/gu)].map(
          (match) => match[1],
        );
        return `${path.basename(item.filename)} ${element} ${component}`;
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

test('the template design system exports Button and TextField', () => {
  const exports = designSystemExports(root);
  expect(exports.get('Button')).toBe('@repo/design-system/ui/button');
  expect(exports.get('TextField')).toBe('@repo/design-system/ui/text-field');
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
      'screen.tsx': `
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
    'screen.tsx <RN.TouchableOpacity> Button',
    'screen.tsx <Tap> Button',
    'screen.tsx <TextInput> TextField',
    'screen.tsx <button> Button',
    'screen.tsx <input> TextField',
    'screen.tsx <input> TextField',
  ]);
});

test('the rule skips test files and elements that the design system does not wrap', async () => {
  expect(
    await lint({
      'screen.test.tsx': `export function Probe() { return <button type="button" />; }`,
      'layout.tsx': `
        import { Text, View } from 'react-native';
        export function Layout() { return <View><Text>Hi</Text><div /><textarea /></View>; }
      `,
    }),
  ).toEqual([]);
});

test('the rule skips the files that the ratchet holds, unless REPO_LINT_ALL is set', async () => {
  const directory = await mkdtemp(path.join(tmpdir(), 'component-ratchet-'));
  try {
    await mkdir(path.join(directory, '.clutch'));
    await writeFile(
      path.join(directory, '.clutch/ratchets.json'),
      JSON.stringify({
        schemaVersion: 1,
        ratchets: {
          'design-system-only': { command: 'x', files: '**/*.tsx', counts: { 'apps/a.tsx': 2 } },
        },
      }),
    );
    expect([...ratchetedFiles(directory)]).toEqual(['apps/a.tsx']);
    process.env.REPO_LINT_ALL = '1';
    expect([...ratchetedFiles(directory)]).toEqual([]);
  } finally {
    delete process.env.REPO_LINT_ALL;
    await rm(directory, { recursive: true, force: true });
  }
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
