import { expect, test } from 'bun:test';
import path from 'node:path';

import { loadClutchConfig } from '@/clutch-config/load';
import { gitRepo } from '@/testing/git-repo';

test('a repository without clutch.yaml has not adopted Clutch', async () => {
  await using repo = await gitRepo({ 'package.json': '{}' }, { git: false });
  expect(await loadClutchConfig(repo.root)).toEqual({ kind: 'not-adopted' });
});

test('a file that is not YAML, or breaks the schema, is invalid with a path', async () => {
  await using repo = await gitRepo({ 'clutch.yaml': 'schemaVersion: [1\n' }, { git: false });
  expect(await loadClutchConfig(repo.root)).toMatchObject({
    kind: 'invalid',
    errors: [{ path: '' }],
  });
  await repo.write({ 'clutch.yaml': 'schemaVersion: 1\nproject: shop\ncapabilities: {}\n' });
  expect(await loadClutchConfig(repo.root)).toMatchObject({
    kind: 'invalid',
    errors: [{ path: 'template' }],
  });
});

test("the template's own clutch.yaml loads", async () => {
  const root = path.resolve(import.meta.dir, '../../../..');
  expect(await loadClutchConfig(root)).toMatchObject({
    kind: 'loaded',
    config: { project: 'clutch', template: { mode: 'doctor' } },
  });
});
