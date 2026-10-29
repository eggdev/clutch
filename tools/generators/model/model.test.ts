import { expect, test } from 'bun:test';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';

import type { Tree } from '@nx/devkit';
import { createTreeWithEmptyWorkspace } from '@nx/devkit/testing';
import { modelGenerator, parseGroup } from '@tools/generators/model/generator.ts';
import { addPackage } from '@tools/generators/package/generator.ts';

const root = path.resolve(import.meta.dir, '../../..');

/** A tree with a `ledger` package that has `repo/`, as the package generator writes it. */
async function ledger(): Promise<Tree> {
  const tree = createTreeWithEmptyWorkspace();
  for (const file of [
    'docs/contributing/architecture/primitives.yaml',
    'apps/api/src/packages.ts',
    'apps/api/package.json',
  ]) {
    tree.write(file, await readFile(path.join(root, file), 'utf-8'));
  }
  for (const name of ['effect', 'drizzle-orm', 'drizzle-kit']) {
    tree.write(`node_modules/${name}/package.json`, JSON.stringify({ version: '1.0.0' }));
  }
  addPackage(tree, {
    name: 'ledger',
    sections: 'types,models,repo,runtime',
    record: 'entry',
    group: 'org',
  });
  return tree;
}

/** Each oxlint diagnostic in the generated package, with the real config. */
async function lint(tree: Tree): Promise<Array<string>> {
  const folder = await mkdtemp(path.join(tmpdir(), 'model-'));
  try {
    for (const change of tree.listChanges()) {
      if (change.type !== 'DELETE' && change.path.startsWith('packages/')) {
        await mkdir(path.join(folder, path.dirname(change.path)), { recursive: true });
        await writeFile(path.join(folder, change.path), change.content ?? '');
      }
    }
    const run = Bun.spawnSync([
      path.join(root, 'node_modules/.bin/oxlint'),
      '-c',
      path.join(root, 'oxlint.config.ts'),
      '--format',
      'json',
      path.join(folder, 'packages'),
    ]);
    const result = JSON.parse(run.stdout.toString());
    return result.diagnostics.map(
      (item: { code: string; filename: string }) =>
        `${path.relative(folder, item.filename)} ${item.code}`,
    );
  } finally {
    await rm(folder, { recursive: true, force: true });
  }
}

test('--group names org, user or a kind and its field, and nothing else', () => {
  expect(parseGroup('org')).toEqual({ kind: 'org', field: null });
  expect(parseGroup('user')).toEqual({ kind: 'user', field: 'userId' });
  expect(parseGroup('space:spaceId')).toEqual({ kind: 'space', field: 'spaceId' });
  for (const wrong of ['', 'space', 'org:organizationId', 'Space:id', 'space:space_id']) {
    expect(() => parseGroup(wrong)).toThrow('is not a group.');
  }
});

test('the CLI requires --group, so a model never syncs to the organization by default', async () => {
  const schema = JSON.parse(await readFile(path.join(import.meta.dir, 'schema.json'), 'utf-8')) as {
    required: Array<string>;
  };
  expect(schema.required).toContain('group');
});

test('a kind group adds its field to the record, the table and the row mapping', async () => {
  const tree = await ledger();
  await modelGenerator(tree, { package: 'ledger', name: 'account', group: 'space:spaceId' });
  expect(tree.read('packages/ledger/types/account.ts', 'utf-8')).toContain(
    'spaceId: Schema.String',
  );
  const model = tree.read('packages/ledger/models/account.ts', 'utf-8') ?? '';
  expect(model).toContain(`groupsOf: (record) => [\`space:\${record.spaceId}\`]`);
  expect(model).not.toContain('organizationGroup');
  expect(tree.read('packages/ledger/repo/schema.ts', 'utf-8')).toContain(
    "spaceId: text('space_id').notNull(),",
  );
  expect(tree.read('packages/ledger/repo/account.ts', 'utf-8')).toContain('spaceId: row.spaceId,');
  expect(tree.read('packages/ledger/repo/account.test.ts', 'utf-8')).toContain(
    "spaceId: 'space-1',",
  );
  expect(await lint(tree)).toEqual([]);
});

test('user and org groups use the built-in helpers', async () => {
  const tree = await ledger();
  await modelGenerator(tree, { package: 'ledger', name: 'draft', group: 'user' });
  await modelGenerator(tree, { package: 'ledger', name: 'notice', group: 'org' });
  const draft = tree.read('packages/ledger/models/draft.ts', 'utf-8') ?? '';
  expect(draft).toContain('groupsOf: (record) => [userGroup(record.userId)]');
  expect(draft).toContain("import { defineModel, userGroup } from '@repo/sync/models/define';");
  const notice = tree.read('packages/ledger/models/notice.ts', 'utf-8') ?? '';
  expect(notice).toContain('groupsOf: (_, scope) => [organizationGroup(scope.organizationId)]');
  expect(tree.read('packages/ledger/types/notice.ts', 'utf-8')).not.toContain('Id: Schema');
  expect(await lint(tree)).toEqual([]);
});
