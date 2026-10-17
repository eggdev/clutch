import { expect, test } from 'bun:test';

import { mergePackageJson } from '@apps/cli/src/merge-package-json';

test("the project keeps its identity and dependencies, and gains the template's scripts and tools", () => {
  const project = {
    name: 'shop',
    version: '2.3.0',
    scripts: { dev: 'vite' },
    dependencies: { react: '^19.0.0' },
    devDependencies: { vite: '^7.0.0' },
  };
  const template = {
    name: 'project-template',
    version: '0.0.0',
    license: 'UNLICENSED',
    scripts: { validate: 'nx run-many -t test' },
    devDependencies: { nx: '23.2.1' },
  };
  expect(mergePackageJson(project, template)).toEqual({
    manifest: {
      name: 'shop',
      version: '2.3.0',
      scripts: { dev: 'vite', validate: 'nx run-many -t test' },
      dependencies: { react: '^19.0.0' },
      devDependencies: { vite: '^7.0.0', nx: '23.2.1' },
    },
    conflicts: [],
  });
});

test('on a clash the template value wins, and each clash is recorded with both values', () => {
  const project = {
    packageManager: 'pnpm@10.4.0',
    scripts: { test: 'jest', lint: 'eslint .' },
    devDependencies: { typescript: '~5.8.0' },
    nx: { targets: { build: { executor: 'nx:run-commands', options: { command: 'vite build' } } } },
  };
  const template = {
    packageManager: 'bun@1.4.2',
    scripts: { lint: 'nx run-many -t lint' },
    devDependencies: { typescript: '~6.0.3' },
    nx: { targets: { build: { options: { command: 'tsgo -b' } } } },
  };
  expect(mergePackageJson(project, template)).toEqual({
    manifest: {
      packageManager: 'bun@1.4.2',
      scripts: { test: 'jest', lint: 'nx run-many -t lint' },
      devDependencies: { typescript: '~6.0.3' },
      nx: { targets: { build: { executor: 'nx:run-commands', options: { command: 'tsgo -b' } } } },
    },
    conflicts: [
      { path: 'packageManager', project: 'pnpm@10.4.0', template: 'bun@1.4.2' },
      { path: 'scripts.lint', project: 'eslint .', template: 'nx run-many -t lint' },
      { path: 'devDependencies.typescript', project: '~5.8.0', template: '~6.0.3' },
      { path: 'nx.targets.build.options.command', project: 'vite build', template: 'tsgo -b' },
    ],
  });
});

test("workspace lists combine, so the project's packages and the template's folders both resolve", () => {
  expect(
    mergePackageJson(
      { workspaces: ['packages/*', 'services/*'] },
      { workspaces: ['apps/*', 'packages/*'] },
    ),
  ).toEqual({
    manifest: { workspaces: ['packages/*', 'services/*', 'apps/*'] },
    conflicts: [],
  });
});
