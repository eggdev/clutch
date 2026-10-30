import { expect, test } from 'bun:test';
import { readFile } from 'node:fs/promises';
import path from 'node:path';

import { gitOrThrow } from '@/git';
import { runSync } from '@/sync/run';
import { gitRepo } from '@/testing/git-repo';

const list = 'version: 1\nfiles:\n  - path: package.json\n    rule: merge\n';
const pkg = (validate: string) => JSON.stringify({ name: 'clutch', scripts: { validate } });

async function commit(root: string) {
  await gitOrThrow(root, 'add', '--all');
  await gitOrThrow(root, 'commit', '--quiet', '--message', 'Next');
  return gitOrThrow(root, 'rev-parse', 'HEAD');
}

/** A Clutch checkout and a project with its own validate script. */
async function setup() {
  const template = await gitRepo({ 'clutch.files.yaml': list, 'package.json': pkg('nx run-many') });
  await gitOrThrow(template.root, 'tag', 'v0.1.0');
  const project = await gitRepo({
    'package.json': JSON.stringify({ name: 'shop', scripts: { validate: 'make check' } }),
  });
  return { template, project };
}

const scripts = async (root: string) =>
  JSON.parse(await readFile(path.join(root, 'package.json'), 'utf-8')).scripts;

test('a package.json clash is a decision, and a sync without an answer keeps the project value', async () => {
  const { template, project } = await setup();
  await using _template = template;
  await using _project = project;
  const checked = await runSync({ root: project.root, template: template.root, check: true });
  expect([checked.status, checked.decisions]).toEqual([
    'decisions',
    ['package.json#scripts.validate'],
  ]);
  const synced = await runSync({ root: project.root, template: template.root });
  expect(synced.status).toBe('decisions');
  expect(await scripts(project.root)).toEqual({ validate: 'make check' });
});

test('keep holds the project value and stays quiet until Clutch changes that value', async () => {
  const { template, project } = await setup();
  await using _template = template;
  await using _project = project;
  const kept = await runSync({
    root: project.root,
    template: template.root,
    keep: ['package.json#scripts.validate'],
  });
  expect(kept.status).toBe('synced');
  expect(await scripts(project.root)).toEqual({ validate: 'make check' });
  await commit(project.root);
  expect(await runSync({ root: project.root, template: template.root, check: true })).toMatchObject(
    {
      status: 'unchanged',
      decisions: [],
    },
  );
  await template.write({ 'package.json': pkg('nx affected -t test') });
  const changed = await commit(template.root);
  const again = await runSync({
    root: project.root,
    template: template.root,
    to: changed,
    check: true,
  });
  expect(again.decisions).toEqual(['package.json#scripts.validate']);
});

test("take lets Clutch's value win, and an answer for a key with no clash is refused", async () => {
  const { template, project } = await setup();
  await using _template = template;
  await using _project = project;
  const taken = await runSync({
    root: project.root,
    template: template.root,
    take: ['package.json#scripts.validate'],
  });
  expect(taken.status).toBe('synced');
  expect(taken.mergeClashes).toEqual([{ file: 'package.json', key: 'scripts.validate' }]);
  expect(await scripts(project.root)).toEqual({ validate: 'nx run-many' });
  await expect(
    runSync({ root: project.root, template: template.root, keep: ['package.json#scripts.dev'] }),
  ).rejects.toThrow('package.json#scripts.dev needs no decision.');
});
