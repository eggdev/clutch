import { afterAll, beforeAll, expect, test } from 'bun:test';
import { readFile, unlink, writeFile } from 'node:fs/promises';
import path from 'node:path';

import { gitOrThrow } from '@/git';
import { runSync } from '@/sync/run';
import { lineagePath } from '@/sync/source';
import { gitRepo } from '@/testing/git-repo';

const list = [
  'version: 1',
  'files:',
  '  - path: tools/',
  '    rule: managed',
  '  - path: docs/',
  '    rule: seed',
  '  - path: AGENTS.md',
  '    rule: seed',
].join('\n');

/** Clutch at v1.0.0, then v1.1.0 changes a seed page, a managed file and a seed page the project deleted. */
async function clutch() {
  const repo = await gitRepo({
    'clutch.files.yaml': list,
    'tools/check.ts': 'v1\n',
    'docs/review.md': 'review v1\n',
    'docs/unchanged.md': 'same\n',
    'docs/deleted.md': 'gone v1\n',
    'AGENTS.md': 'agents v1\n',
  });
  await gitOrThrow(repo.root, 'tag', 'v1.0.0');
  await repo.write({
    'tools/check.ts': 'v2\n',
    'docs/review.md': 'review v2\n',
    'docs/deleted.md': 'gone v2\n',
    'AGENTS.md': 'agents v2\n',
  });
  await gitOrThrow(repo.root, 'add', '--all');
  await gitOrThrow(repo.root, 'commit', '--quiet', '--message', 'Second');
  await gitOrThrow(repo.root, 'tag', 'v1.1.0');
  return repo;
}

// The tests only read the checkout, so they share one.
let shared: Awaited<ReturnType<typeof clutch>>;
beforeAll(async () => {
  shared = await clutch();
});
afterAll(() => shared[Symbol.asyncDispose]());

/** A project with its own seed pages. It is not synced yet. */
function project() {
  return gitRepo({
    'package.json': JSON.stringify({ name: 'shop', scripts: { dev: 'vite' } }),
    'docs/review.md': 'project review\n',
    'docs/unchanged.md': 'same\n',
    'docs/deleted.md': 'gone\n',
    'AGENTS.md': 'project agents\n',
  });
}

async function commitAll(root: string) {
  await gitOrThrow(root, 'add', '--all');
  await gitOrThrow(root, 'commit', '--quiet', '--message', 'Sync');
}

test('a sync lists the seed pages that Clutch changed, and not the others', async () => {
  const template = shared;
  await using target = await project();
  expect(await runSync({ root: target.root, template: template.root, to: 'v1.0.0' })).toMatchObject(
    { status: 'synced', seedChanges: [], seedChangesNote: null },
  );
  await commitAll(target.root);
  await unlink(path.join(target.root, 'docs/deleted.md'));
  await commitAll(target.root);

  const planned = await runSync({
    root: target.root,
    template: template.root,
    to: 'v1.1.0',
    check: true,
  });
  expect(planned.status).toBe('planned');
  expect(planned.seedChangesNote).toBeNull();
  expect(planned.seedChanges.map((change) => change.path).toSorted()).toEqual([
    'AGENTS.md',
    'docs/review.md',
  ]);
  expect(planned.seedChanges.find((change) => change.path === 'docs/review.md')?.see).toBe(
    `git -C ${template.root} diff v1.0.0 v1.1.0 -- docs/review.md`,
  );
});

test('a sync lists the changed seed pages, and leaves the project copies as they are', async () => {
  const template = shared;
  await using target = await project();
  await runSync({ root: target.root, template: template.root, to: 'v1.0.0' });
  await commitAll(target.root);

  const synced = await runSync({ root: target.root, template: template.root, to: 'v1.1.0' });
  expect(synced.status).toBe('synced');
  expect(synced.seedChanges.map((change) => change.path).toSorted()).toEqual([
    'AGENTS.md',
    'docs/deleted.md',
    'docs/review.md',
  ]);
  expect(await readFile(path.join(target.root, 'docs/review.md'), 'utf-8')).toBe(
    'project review\n',
  );
  expect(await readFile(path.join(target.root, 'AGENTS.md'), 'utf-8')).toBe('project agents\n');
  expect(await readFile(path.join(target.root, lineagePath), 'utf-8')).toContain('"v1.1.0"');
});

test('a sync that cannot read its last release lists nothing, and says why', async () => {
  const template = shared;
  await using target = await project();
  await runSync({ root: target.root, template: template.root, to: 'v1.0.0' });
  await commitAll(target.root);
  const lineage = JSON.parse(await readFile(path.join(target.root, lineagePath), 'utf-8'));
  await writeFile(
    path.join(target.root, lineagePath),
    JSON.stringify({ ...lineage, release: 'v0.0.1' }),
  );

  const planned = await runSync({
    root: target.root,
    template: template.root,
    to: 'v1.1.0',
    check: true,
  });
  expect(planned.status).toBe('planned');
  expect(planned.seedChanges).toEqual([]);
  expect(planned.seedChangesNote).toContain('v0.0.1');
});
