import { expect, test } from 'bun:test';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { classProblem, splitClass } from '@tools/lint/class-policy.mjs';

const root = path.resolve(import.meta.dir, '../..');

/** Lints one TSX file and lists `rule token` for each class diagnostic. */
async function lint(source: string): Promise<Array<string>> {
  const directory = await mkdtemp(path.join(tmpdir(), 'class-rule-'));
  try {
    await writeFile(path.join(directory, 'screen.tsx'), source);
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
      .filter((item: { code: string }) => item.code.startsWith('repo-classes('))
      .map(
        (item: { code: string; message: string }) =>
          `${item.code.replace(/^repo-classes\((.+)\)$/u, '$1')} ${item.message.match(/`([^`]+)`/u)?.[1]}`,
      )
      .toSorted();
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
}

test('splitClass keeps brackets and parentheses inside one part', () => {
  expect(splitClass('data-[state=open]:@md:hover:bg-surface')).toEqual({
    variants: ['data-[state=open]', '@md', 'hover'],
    utility: 'bg-surface',
  });
  expect(splitClass('[&>svg]:-translate-x-1!')).toEqual({
    variants: ['[&>svg]'],
    utility: 'translate-x-1',
  });
});

test('classProblem accepts roles, variable shorthands and named transitions', () => {
  for (const token of [
    'bg-surface',
    'text-fg-muted',
    '@md:flex-row',
    'data-[state=open]:bg-selected',
    '[&>svg]:size-4',
    'duration-(--speed-quick)',
    'delay-(--speed-fade-out)',
    'transition',
    'transition-colors',
    'bg-(--accent)',
    'p-4',
  ]) {
    expect(classProblem(token)).toBeNull();
  }
});

test('classProblem names the rule that each class breaks', () => {
  expect(classProblem('bg-[#fff]')).toBe('no-arbitrary-values');
  expect(classProblem('hover:p-[13px]')).toBe('no-arbitrary-values');
  expect(classProblem('[mask-type:luminance]')).toBe('no-arbitrary-values');
  expect(classProblem('duration-[300ms]')).toBe('no-arbitrary-values');
  expect(classProblem('duration-300')).toBe('speed-tokens-only');
  expect(classProblem('delay-0')).toBe('speed-tokens-only');
  expect(classProblem('duration-(--slow)')).toBe('speed-tokens-only');
  expect(classProblem('transition-all')).toBe('no-transition-all');
  expect(classProblem('dark:bg-surface')).toBe('no-dark-variant');
  expect(classProblem('@md:dark:bg-[#000]')).toBe('no-dark-variant');
});

test('class lint reads attributes, templates, helpers and cva variants', async () => {
  expect(
    await lint(`
      const button = cva('rounded-control transition-all', {
        variants: { tone: { danger: 'bg-[#f00]' } },
      });
      export function Screen({ open }: { open: boolean }) {
        return (
          <div className="duration-300 dark:bg-surface">
            <span className={\`p-4 \${open ? 'w-[12px]' : ''}\`} />
            <span className={cn('p-4', { 'delay-150': open })} />
            <button className={button({ tone: 'danger' })} />
          </div>
        );
      }
    `),
  ).toEqual([
    'no-arbitrary-values bg-[#f00]',
    'no-arbitrary-values w-[12px]',
    'no-dark-variant dark:bg-surface',
    'no-transition-all transition-all',
    'speed-tokens-only delay-150',
    'speed-tokens-only duration-300',
  ]);
});

test('class lint ignores strings that are not classes', async () => {
  expect(
    await lint(`
      const label = 'duration-300 dark:bg-[#fff]';
      export function Screen() {
        return <div className="bg-surface transition-colors duration-(--speed-quick)" title={label} />;
      }
    `),
  ).toEqual([]);
});
