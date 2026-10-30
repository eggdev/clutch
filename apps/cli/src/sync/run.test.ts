import { expect, test } from 'bun:test';
import { readFile } from 'node:fs/promises';
import path from 'node:path';

import { gitOrThrow } from '@/git';
import { syncCommand } from '@/sync-command';
import { runSync } from '@/sync/run';
import { lineagePath } from '@/sync/source';
import { gitRepo } from '@/testing/git-repo';

const list = [
  'version: 1',
  'files:',
  '  - path: tools/',
  '    rule: managed',
  '  - path: docs/principles/',
  '    rule: managed',
  '  - path: docs/',
  '    rule: seed',
  '  - path: AGENTS.md',
  '    rule: seed',
  '  - path: package.json',
  '    rule: merge',
  'retired:',
  '  - tools/old.ts',
].join('\n');

/** A Clutch checkout with two commits. The second changes, adds and retires tooling. */
async function clutch() {
  const repo = await gitRepo({
    'clutch.files.yaml': list,
    'tools/check.ts': 'v1\n',
    'tools/old.ts': 'old\n',
    'docs/principles/a.md': '# A\n',
    'docs/project.md': '# Project\n',
    'AGENTS.md': '# Agents\n',
    'package.json': JSON.stringify({ name: 'clutch', scripts: { validate: 'nx run-many' } }),
  });
  const first = await gitOrThrow(repo.root, 'rev-parse', 'HEAD');
  await gitOrThrow(repo.root, 'rm', '--quiet', 'tools/old.ts');
  await repo.write({ 'tools/check.ts': 'v2\n', 'tools/new.ts': 'new\n' });
  await gitOrThrow(repo.root, 'add', '--all');
  await gitOrThrow(repo.root, 'commit', '--quiet', '--message', 'Second');
  const second = await gitOrThrow(repo.root, 'rev-parse', 'HEAD');
  return { repo, first, second };
}

function project(files: Record<string, string> = {}) {
  return gitRepo({
    'package.json': JSON.stringify({ name: 'shop', scripts: { dev: 'vite' } }),
    ...files,
  });
}

const commitAll = async (root: string) => {
  await gitOrThrow(root, 'add', '--all');
  await gitOrThrow(root, 'commit', '--quiet', '--message', 'Sync');
};

test('a sync writes managed files, merges package.json and skips seed files, then --check is clean', async () => {
  const { repo, first } = await clutch();
  await using template = repo;
  await using target = await project();
  const synced = await runSync({ root: target.root, template: template.root, to: first });
  expect(synced.status).toBe('synced');
  expect(await readFile(path.join(target.root, 'tools/check.ts'), 'utf-8')).toBe('v1\n');
  expect(await Bun.file(path.join(target.root, 'AGENTS.md')).exists()).toBe(false);
  expect(await Bun.file(path.join(target.root, 'docs/project.md')).exists()).toBe(false);
  const manifest = JSON.parse(await readFile(path.join(target.root, 'package.json'), 'utf-8'));
  expect(manifest).toEqual({ name: 'shop', scripts: { dev: 'vite', validate: 'nx run-many' } });
  const lineage = JSON.parse(await readFile(path.join(target.root, lineagePath), 'utf-8'));
  expect(lineage).toMatchObject({ schemaVersion: 1, templateCommit: first });
  await commitAll(target.root);
  expect(
    await runSync({ root: target.root, template: template.root, to: first, check: true }),
  ).toMatchObject({
    status: 'unchanged',
    changes: [],
  });
});

test('the next commit updates, adds and retires managed files', async () => {
  const { repo, first, second } = await clutch();
  await using template = repo;
  await using target = await project();
  await runSync({ root: target.root, template: template.root, to: first });
  await commitAll(target.root);
  const planned = await runSync({
    root: target.root,
    template: template.root,
    to: second,
    check: true,
  });
  expect(planned.status).toBe('planned');
  expect(planned.changes).toEqual([
    { path: 'tools/check.ts', action: 'update' },
    { path: 'tools/new.ts', action: 'add' },
    { path: 'tools/old.ts', action: 'remove' },
    { path: lineagePath, action: 'update' },
  ]);
  await runSync({ root: target.root, template: template.root, to: second });
  expect(await Bun.file(path.join(target.root, 'tools/old.ts')).exists()).toBe(false);
  expect(await readFile(path.join(target.root, 'tools/check.ts'), 'utf-8')).toBe('v2\n');
});

test('a managed file that the project edited needs a decision, and nothing changes', async () => {
  const { repo, first, second } = await clutch();
  await using template = repo;
  await using target = await project();
  await runSync({ root: target.root, template: template.root, to: first });
  await target.write({ 'tools/check.ts': 'my own check\n' });
  await commitAll(target.root);
  const result = await runSync({ root: target.root, template: template.root, to: second });
  expect([result.status, result.decisions]).toEqual(['decisions', ['tools/check.ts']]);
  expect(await readFile(path.join(target.root, 'tools/check.ts'), 'utf-8')).toBe('my own check\n');
});

test('a project with only review tooling starts from .review/tooling.json', async () => {
  const { repo, first, second } = await clutch();
  await using template = repo;
  await using target = await project();
  await runSync({ root: target.root, template: template.root, to: first });
  const { files } = JSON.parse(await readFile(path.join(target.root, lineagePath), 'utf-8'));
  await target.write({
    '.review/tooling.json': JSON.stringify({ schemaVersion: 1, templateCommit: first, files }),
  });
  await Bun.file(path.join(target.root, lineagePath)).delete();
  await commitAll(target.root);
  const planned = await runSync({
    root: target.root,
    template: template.root,
    to: second,
    check: true,
  });
  expect(planned.decisions).toEqual([]);
  expect(planned.changes).toContainEqual({ path: lineagePath, action: 'add' });
});

test('sync --check exits 0 when clean, 2 with changes or decisions, and 1 on an error', async () => {
  const { repo, first, second } = await clutch();
  await using template = repo;
  await using target = await project();
  const sync = (...args: Array<string>) =>
    syncCommand(['--root', target.root, '--json', ...args], target.root, template.root);
  const output: Array<string> = [];
  const { log } = console;
  console.log = (line: string) => output.push(line);
  try {
    expect(await sync('--to', first, '--check')).toBe(2);
    expect(await sync('--to', first)).toBe(0);
    await commitAll(target.root);
    expect(await sync('--to', first, '--check')).toBe(0);
    expect(await sync('--to', second, '--check')).toBe(2);
    expect(await sync('--to', 'no-such-commit', '--check')).toBe(1);
  } finally {
    console.log = log;
  }
  expect(JSON.parse(output.at(-1) ?? '{}')).toMatchObject({ status: 'error' });
});

test('without --to a sync takes the latest release, records it and drops an older pin', async () => {
  const { repo, first, second } = await clutch();
  await using template = repo;
  await gitOrThrow(template.root, 'tag', 'v0.1.0', first);
  await using target = await project({
    'clutch.yaml': `schemaVersion: 1\nproject: shop\ntemplate:\n  repo: eggdev/clutch\n  commit: ${second}\n  mode: sync\n`,
  });
  const synced = await runSync({ root: target.root, template: template.root });
  expect(synced).toMatchObject({
    status: 'synced',
    templateCommit: first,
    release: 'v0.1.0',
    latest: true,
  });
  expect(synced.changes).toContainEqual({ path: 'clutch.yaml', action: 'update' });
  expect(await readFile(path.join(target.root, 'clutch.yaml'), 'utf-8')).not.toContain('commit');
  const lineage = JSON.parse(await readFile(path.join(target.root, lineagePath), 'utf-8'));
  expect(lineage).toMatchObject({ templateCommit: first, release: 'v0.1.0' });
  await commitAll(target.root);

  await gitOrThrow(template.root, 'tag', 'v0.2.0', second);
  const output: Array<string> = [];
  const { log } = console;
  console.log = (line: string) => output.push(line);
  try {
    expect(await syncCommand(['--check'], target.root, template.root)).toBe(2);
  } finally {
    console.log = log;
  }
  expect(output.slice(-2)).toEqual([
    'The project would move to Clutch v0.2.0, the latest release.',
    'The project is behind the latest Clutch release. Run clutch sync to take it.',
  ]);
});

test('without a release tag, a sync without --to stops and says how to fix it', async () => {
  const { repo } = await clutch();
  await using template = repo;
  await using target = await project();
  await expect(runSync({ root: target.root, template: template.root })).rejects.toThrow(
    'has no Clutch release tag',
  );
});
