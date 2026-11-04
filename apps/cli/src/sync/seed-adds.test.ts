import { expect, test } from 'bun:test';
import { readFile, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';

import { gitOrThrow } from '@/git';
import { runSync } from '@/sync/run';
import { lineagePath, loadClutchSource } from '@/sync/source';
import { gitRepo } from '@/testing/git-repo';

const list = (extra: Array<string> = []) =>
  [
    'version: 1',
    'files:',
    '  - path: tools/',
    '    rule: managed',
    '  - path: docs/',
    '    rule: seed',
    ...extra,
  ].join('\n');

const factoryEntry = ['  - path: factory/', '    rule: seed', '    add_on_sync: true'];

async function tag(root: string, name: string) {
  await gitOrThrow(root, 'add', '--all');
  await gitOrThrow(root, 'commit', '--quiet', '--message', name);
  await gitOrThrow(root, 'tag', name);
}

/** Clutch v1.0.0 has no factory tree. v1.1.0 adds it and a docs page. v1.2.0 changes an agent and adds one. */
async function clutch() {
  const repo = await gitRepo({
    'clutch.files.yaml': list(),
    'tools/check.ts': 'v1\n',
    'docs/index.md': 'index\n',
  });
  await gitOrThrow(repo.root, 'tag', 'v1.0.0');
  await repo.write({
    'clutch.files.yaml': list(factoryEntry),
    'factory/models.yaml': 'models v1\n',
    'factory/agents/implement/agent.md': 'implement v1\n',
    'docs/new-page.md': 'new page\n',
  });
  await tag(repo.root, 'v1.1.0');
  await repo.write({
    'factory/agents/implement/agent.md': 'implement v2\n',
    'factory/agents/verify/agent.md': 'verify v1\n',
  });
  await tag(repo.root, 'v1.2.0');
  return repo;
}

const project = () => gitRepo({ 'package.json': JSON.stringify({ name: 'shop' }) });

async function commitAll(root: string) {
  await gitOrThrow(root, 'add', '--all');
  await gitOrThrow(root, 'commit', '--quiet', '--message', 'Sync');
}

const read = (root: string, file: string) => readFile(path.join(root, file), 'utf-8');

test('a sync adds the new files of an add_on_sync seed entry once, and no other seed file', async () => {
  await using template = await clutch();
  await using target = await project();
  await runSync({ root: target.root, template: template.root, to: 'v1.0.0' });
  await commitAll(target.root);

  const planned = await runSync({
    root: target.root,
    template: template.root,
    to: 'v1.1.0',
    check: true,
  });
  expect(planned.status).toBe('planned');
  expect(planned.changes.filter((change) => change.path.startsWith('factory/'))).toEqual([
    { path: 'factory/agents/implement/agent.md', action: 'add' },
    { path: 'factory/models.yaml', action: 'add' },
  ]);

  expect(await runSync({ root: target.root, template: template.root, to: 'v1.1.0' })).toMatchObject(
    { status: 'synced', seedChangesNote: null },
  );
  expect(await read(target.root, 'factory/agents/implement/agent.md')).toBe('implement v1\n');
  expect(await Bun.file(path.join(target.root, 'docs/new-page.md')).exists()).toBe(false);
  await writeFile(path.join(target.root, 'factory/agents/implement/agent.md'), 'project prompt\n');
  await rm(path.join(target.root, 'factory/models.yaml'));
  await commitAll(target.root);

  const next = await runSync({ root: target.root, template: template.root, to: 'v1.2.0' });
  expect(next.status).toBe('synced');
  expect(next.changes.filter((change) => change.path.startsWith('factory/'))).toEqual([
    { path: 'factory/agents/verify/agent.md', action: 'add' },
  ]);
  expect(next.seedChanges).toEqual([
    {
      path: 'factory/agents/implement/agent.md',
      see: `git -C ${template.root} diff v1.1.0 v1.2.0 -- factory/agents/implement/agent.md`,
    },
  ]);
  expect(await read(target.root, 'factory/agents/implement/agent.md')).toBe('project prompt\n');
  expect(await Bun.file(path.join(target.root, 'factory/models.yaml')).exists()).toBe(false);
  expect(await read(target.root, 'factory/agents/verify/agent.md')).toBe('verify v1\n');
});

test('a sync keeps a file that the project wrote at a path that Clutch adds', async () => {
  await using template = await clutch();
  await using target = await project();
  await runSync({ root: target.root, template: template.root, to: 'v1.0.0' });
  await target.write({ 'factory/models.yaml': 'project models\n' });
  await commitAll(target.root);

  const synced = await runSync({ root: target.root, template: template.root, to: 'v1.1.0' });
  expect(synced.changes.map((change) => change.path)).toContain(
    'factory/agents/implement/agent.md',
  );
  expect(synced.changes.map((change) => change.path)).not.toContain('factory/models.yaml');
  expect(await read(target.root, 'factory/models.yaml')).toBe('project models\n');
});

test('a sync adds the files that an older sync skipped, since the lineage does not list them', async () => {
  await using template = await clutch();
  await using target = await project();
  await runSync({ root: target.root, template: template.root, to: 'v1.0.0' });
  await commitAll(target.root);
  // A Clutch binary from before add_on_sync moved the project to v1.1.0, and added no tree.
  const lineage = JSON.parse(await read(target.root, lineagePath));
  const commit = await gitOrThrow(template.root, 'rev-parse', 'v1.1.0^{commit}');
  await writeFile(
    path.join(target.root, lineagePath),
    JSON.stringify({ ...lineage, templateCommit: commit, release: 'v1.1.0' }),
  );
  await commitAll(target.root);

  const synced = await runSync({ root: target.root, template: template.root, to: 'v1.2.0' });
  expect(synced.changes.filter((change) => change.path.startsWith('factory/'))).toEqual([
    { path: 'factory/agents/implement/agent.md', action: 'add' },
    { path: 'factory/agents/verify/agent.md', action: 'add' },
    { path: 'factory/models.yaml', action: 'add' },
  ]);
  expect(JSON.parse(await read(target.root, lineagePath)).seeded).toEqual([
    'factory/agents/implement/agent.md',
    'factory/agents/verify/agent.md',
    'factory/models.yaml',
  ]);
});

test('add_on_sync is only for a seed entry', async () => {
  await using template = await gitRepo({
    'clutch.files.yaml': list(['  - path: factory/', '    rule: managed', '    add_on_sync: true']),
    'tools/check.ts': 'v1\n',
    'docs/index.md': 'index\n',
    'factory/models.yaml': 'models\n',
  });
  expect(loadClutchSource(template.root, 'HEAD')).rejects.toThrow(
    'factory/ has add_on_sync. Only a seed entry takes it',
  );
});
