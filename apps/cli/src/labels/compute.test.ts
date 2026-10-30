import { expect, test } from 'bun:test';

import { areaOf, changeLabels, kindLabel, workspaceGlobs } from '@/labels/compute';

const workspaces = ['apps/*', 'packages/*', 'tools/generators'];

test('the kind comes from the conventional type of the title', () => {
  expect(kindLabel('feat(cli)!: add x')?.name).toBe('kind/feat');
  expect(kindLabel('fix: y')?.name).toBe('kind/fix');
  expect(kindLabel('Merge pull request #1')).toBeUndefined();
  expect(kindLabel('wip: z')).toBeUndefined();
});

test('a workspace file is the area of its package, and any other file of its top folder', () => {
  expect(areaOf('apps/cli/src/main.ts', workspaces)).toBe('cli');
  expect(areaOf('packages/sync/index.ts', workspaces)).toBe('sync');
  expect(areaOf('tools/generators/x.ts', workspaces)).toBe('generators');
  expect(areaOf('tools/check-x.ts', workspaces)).toBe('tools');
  expect(areaOf('.github/workflows/ci.yml', workspaces)).toBe('github');
  expect(areaOf('package.json', workspaces)).toBe('root');
  // A file directly in the workspace parent belongs to no package.
  expect(areaOf('apps/README.md', workspaces)).toBe('apps');
});

test('workspaces come from the array or the packages form of package.json', () => {
  expect(workspaceGlobs({ workspaces: ['apps/*'] })).toEqual(['apps/*']);
  expect(workspaceGlobs({ workspaces: { packages: ['libs/*'] } })).toEqual(['libs/*']);
  expect(workspaceGlobs(null)).toEqual([]);
});

test('a change gets one kind and each area once, and the one-way-door label is defined', () => {
  const labels = changeLabels(
    'docs: explain x',
    ['docs/a.md', 'docs/b.md', 'apps/cli/README.md'],
    workspaces,
  );
  expect(labels.apply.map((label) => label.name)).toEqual(['kind/docs', 'area/cli', 'area/docs']);
  expect(labels.define.map((label) => label.name)).toContain('one-way-door');
  for (const label of labels.define) {
    expect(label.color).toMatch(/^[0-9a-f]{6}$/u);
    expect(label.description.length).toBeLessThanOrEqual(100);
  }
});
