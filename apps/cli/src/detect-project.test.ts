import { expect, test } from 'bun:test';
import path from 'node:path';

import { detectProject } from '@/detect-project';
import { gitOrThrow as git } from '@/git';
import { gitRepo } from '@/testing/git-repo';

test('an npm repo with commits is an existing project', async () => {
  await using repo = await gitRepo(
    { 'package.json': '{"name": "shop"}', 'src/index.ts': 'export {};\n' },
    { name: 'shop-web' },
  );
  expect(await detectProject(repo.root)).toEqual({
    kind: 'existing',
    root: repo.root,
    name: 'shop-web',
    defaultBranch: 'main',
  });
});

test('the default branch comes from the remote, not from the branch the user has checked out', async () => {
  await using upstream = await gitRepo({ 'package.json': '{}' });
  await git(upstream.root, 'branch', '--move', 'main', 'trunk');
  await git(upstream.parent, 'clone', '--quiet', upstream.root, 'clone');
  const clone = path.join(upstream.parent, 'clone');
  await git(clone, 'switch', '--quiet', '--create', 'feat/rebuild');
  expect(await detectProject(clone)).toMatchObject({ defaultBranch: 'trunk' });
});

test('without a remote, main is the default branch when it exists', async () => {
  await using repo = await gitRepo({ 'package.json': '{}' });
  await git(repo.root, 'switch', '--quiet', '--create', 'feat/rebuild');
  expect(await detectProject(repo.root)).toMatchObject({ defaultBranch: 'main' });
});

test('a folder that is not a git repo is refused', async () => {
  await using folder = await gitRepo({ 'package.json': '{}' }, { git: false });
  expect(await detectProject(folder.root)).toEqual({
    kind: 'refused',
    reason: `${folder.root} is not a git repository. Run \`git init\` and commit, then run this again.`,
  });
});

test('a repo with uncommitted changes is refused, and the reason names the files', async () => {
  await using repo = await gitRepo({ 'package.json': '{}', 'src/index.ts': 'export {};\n' });
  await repo.write({ 'src/index.ts': 'export const changed = 1;\n', 'notes.md': 'draft\n' });
  expect(await detectProject(repo.root)).toEqual({
    kind: 'refused',
    reason: [
      `${repo.root} has uncommitted changes. Commit or stash them, then run this again:`,
      ' M src/index.ts',
      '?? notes.md',
    ].join('\n'),
  });
});

test('a repo with no package.json is refused, because the template needs a JavaScript workspace', async () => {
  await using repo = await gitRepo({
    'go.mod': 'module example.com/api\n',
    'main.go': 'package main\n',
  });
  expect(await detectProject(repo.root)).toEqual({
    kind: 'refused',
    reason: `${repo.root} has no package.json. The template supports JavaScript and TypeScript projects, alone or next to other languages.`,
  });
});

test('a TypeScript app next to a Python service is an existing project', async () => {
  await using repo = await gitRepo({
    'web/package.json': '{"name": "web"}',
    'web/src/main.ts': 'export {};\n',
    'api/pyproject.toml': '[project]\nname = "api"\n',
  });
  expect(await detectProject(repo.root)).toMatchObject({ kind: 'existing' });
});
