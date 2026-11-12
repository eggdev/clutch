import { expect, test } from 'bun:test';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';

import type { Tree } from '@nx/devkit';
import { createTreeWithEmptyWorkspace } from '@nx/devkit/testing';
import { addPackage } from '@tools/generators/package/generator.ts';
import { addRecord, parseGroup, recordGenerator } from '@tools/generators/record/generator.ts';

const root = path.resolve(import.meta.dir, '../../..');

/** A tree with a `ledger` package that has `contract/` and `repo/`, as the package generator writes it. */
async function ledger(): Promise<Tree> {
  const tree = createTreeWithEmptyWorkspace();
  for (const file of ['docs/contributing/architecture/primitives.yaml', 'apps/api/package.json']) {
    tree.write(file, await readFile(path.join(root, file), 'utf-8'));
  }
  for (const name of ['effect', 'drizzle-orm', 'drizzle-kit']) {
    tree.write(`node_modules/${name}/package.json`, JSON.stringify({ version: '1.0.0' }));
  }
  addPackage(tree, {
    name: 'ledger',
    sections: 'contract,repo,runtime',
    record: 'entry',
    group: 'org',
  });
  return tree;
}

/** Each oxlint diagnostic in the generated package, with the real config. */
async function lint(tree: Tree): Promise<Array<string>> {
  const folder = await mkdtemp(path.join(tmpdir(), 'record-'));
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

test('the CLI requires --group, so a record never syncs to the organization by default', async () => {
  const schema = JSON.parse(await readFile(path.join(import.meta.dir, 'schema.json'), 'utf-8')) as {
    required: Array<string>;
  };
  expect(schema.required).toContain('group');
});

test('a kind group adds its record to the contract, its field, and its table and row mapping', async () => {
  const tree = await ledger();
  recordGenerator(tree, { package: 'ledger', name: 'account', group: 'space:spaceId' });
  const contract = tree.read('packages/ledger/contract/ledger.ts', 'utf-8') ?? '';
  expect(contract).toContain("import { record } from '@repo/sync/contract/record';");
  expect(contract).toContain("import type { RowOf } from '@repo/sync/contract/record';");
  expect(contract).toContain("import { defineGroup } from '@repo/sync/contract/groups';");
  expect(contract).toContain(
    "import { organizationGroup } from '@repo/sync/contract/engine-groups';",
  );
  expect(contract).toContain(
    "export const accountRecord = record('Account', {\n  fields: { id: 'string', spaceId: 'string', createdAt: 'string', updatedAt: 'string' },\n  groups: [defineGroup('space').by('spaceId')],\n});",
  );
  expect(contract).toContain('export type Account = RowOf<typeof accountRecord>;');
  expect(contract).toContain('records: [entryRecord, accountRecord],');
  expect(tree.read('packages/ledger/repo/schema.ts', 'utf-8')).toContain(
    "spaceId: text('space_id').notNull(),",
  );
  const mapping = tree.read('packages/ledger/repo/account.ts', 'utf-8') ?? '';
  expect(mapping).toContain('spaceId: row.spaceId,');
  expect(mapping).toContain("import { accountRecord } from '@repo/ledger/contract/ledger';");
  expect(mapping).toContain('upsertChange(accountRecord, toRecord(row)');
  expect(tree.read('packages/ledger/repo/account.test.ts', 'utf-8')).toContain(
    "spaceId: 'space-1',",
  );
  expect(await lint(tree)).toEqual([]);
});

test('user and org records use the built-in helpers, and one import line per module', async () => {
  const tree = await ledger();
  recordGenerator(tree, { package: 'ledger', name: 'draft', group: 'user' });
  recordGenerator(tree, { package: 'ledger', name: 'notice', group: 'org' });
  const contract = tree.read('packages/ledger/contract/ledger.ts', 'utf-8') ?? '';
  expect(contract).toContain("groups: [userGroup.by('userId')],");
  expect(contract).toContain('groups: [organizationGroup.ofScope],');
  expect(contract).toContain(
    "import { organizationGroup, userGroup } from '@repo/sync/contract/engine-groups';",
  );
  expect(contract.split("from '@repo/sync/contract/record'")).toHaveLength(3);
  expect(contract).toContain('records: [entryRecord, draftRecord, noticeRecord],');
  expect(tree.read('packages/ledger/repo/notice.ts', 'utf-8')).not.toContain('spaceId');
  expect(await lint(tree)).toEqual([]);
});

test('a record needs the contract, and a record that the contract declares fails', async () => {
  const tree = await ledger();
  addPackage(tree, { name: 'drafts', sections: 'types' });
  expect(() => addRecord(tree, { package: 'drafts', name: 'draft', group: 'org' })).toThrow(
    'packages/drafts/contract/drafts.ts does not exist.',
  );
  expect(() => addRecord(tree, { package: 'ledger', name: 'entry', group: 'org' })).toThrow(
    'already declares `entryRecord`',
  );
});
