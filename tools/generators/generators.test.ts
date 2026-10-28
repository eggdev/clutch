import { expect, test } from 'bun:test';
import { mkdir, mkdtemp, readFile, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';

import type { Tree } from '@nx/devkit';
import { createTreeWithEmptyWorkspace } from '@nx/devkit/testing';
import { checkCommands } from '@tools/check-commands';
import { checkDb } from '@tools/check-db';
import { checkStructure } from '@tools/check-structure';
import { addCommand } from '@tools/generators/command/generator.ts';
import { addFeature } from '@tools/generators/feature/generator.ts';
import { modelGenerator } from '@tools/generators/model/generator.ts';
import { addPackage, parseSections } from '@tools/generators/package/generator.ts';

const root = path.resolve(import.meta.dir, '../..');

/** A tree with the files that the generators read from a real workspace. */
async function workspace(): Promise<Tree> {
  const tree = createTreeWithEmptyWorkspace();
  for (const file of [
    'docs/contributing/architecture/primitives.yaml',
    'oxlint.config.ts',
    'apps/web/src/router.ts',
    'apps/web/src/commands.ts',
    'apps/web/package.json',
    'apps/api/src/packages.ts',
    'apps/api/package.json',
  ]) {
    tree.write(file, await readFile(path.join(root, file), 'utf-8'));
  }
  for (const name of ['effect', 'react', '@types/react', 'drizzle-orm', 'drizzle-kit']) {
    tree.write(`node_modules/${name}/package.json`, JSON.stringify({ version: '1.0.0' }));
  }
  return tree;
}

/** Writes each created or changed source file of the tree into a new folder, then runs `check` there. */
async function inFolder<T>(tree: Tree, check: (folder: string) => Promise<T> | T): Promise<T> {
  const folder = await mkdtemp(path.join(tmpdir(), 'generated-'));
  try {
    for (const change of tree.listChanges()) {
      if (change.type !== 'DELETE' && !change.path.startsWith('node_modules/')) {
        await mkdir(path.join(folder, path.dirname(change.path)), { recursive: true });
        await writeFile(path.join(folder, change.path), change.content ?? '');
      }
    }
    return await check(folder);
  } finally {
    await rm(folder, { recursive: true, force: true });
  }
}

/** Each oxlint diagnostic in the generated source files, as `path rule`, with the real config. */
function lintFolder(folder: string): Array<string> {
  const run = Bun.spawnSync([
    path.join(root, 'node_modules/.bin/oxlint'),
    '-c',
    path.join(root, 'oxlint.config.ts'),
    '--format',
    'json',
    path.join(folder, 'packages'),
    path.join(folder, 'features'),
    path.join(folder, 'apps'),
  ]);
  const result = JSON.parse(run.stdout.toString());
  return result.diagnostics.map(
    (item: { code: string; filename: string }) =>
      `${path.relative(folder, item.filename)} ${item.code}`,
  );
}

test('a package, a command and a feature pass lint, the structure check and the command check', async () => {
  const tree = await workspace();
  addPackage(tree, {
    name: 'billing',
    sections: 'types,models,commands,repo,runtime,ui,testing',
    record: 'invoice',
  });
  addCommand(tree, {
    package: 'billing',
    name: 'archive-invoice',
    model: 'invoice',
    waits: 'server',
  });
  addFeature(tree, { name: 'billing' });
  expect(tree.exists('packages/billing/commands/archive-invoice.server.ts')).toBe(true);
  expect(tree.read('packages/billing/commands/archive-invoice.ts', 'utf-8')).toContain(
    "waits: 'server'",
  );
  expect(tree.read('packages/billing/runtime/handlers.server.ts', 'utf-8')).toContain(
    'export const billingServerChanges = [archiveInvoiceServer];',
  );
  expect(tree.read('apps/web/src/commands.ts', 'utf-8')).toContain('...billingCommands');
  expect(tree.read('apps/api/src/packages.ts', 'utf-8')).toContain('...billingServerChanges');
  expect(tree.read('apps/api/src/packages.ts', 'utf-8')).toContain('migrateBilling]');
  expect(tree.read('packages/billing/repo/schema.ts', 'utf-8')).toContain(
    "export const invoiceRecords = pgTable('invoice', {",
  );
  expect(tree.exists('packages/billing/repo/invoice.test.ts')).toBe(true);
  expect(tree.children('packages/billing/repo/migrations')).toEqual(['.gitkeep']);
  expect(tree.read('apps/web/src/router.ts', 'utf-8')).toContain('billingRoute]');
  expect(tree.read('oxlint.config.ts', 'utf-8')).toContain(
    "'/billing': { gate: 'features/billing/gate.ts', routes: 'apps/web/src/routes/billing' }",
  );
  const registry = tree.read('docs/contributing/architecture/primitives.yaml', 'utf-8') ?? '';
  expect(registry).toContain('  - id: billing\n');
  expect(registry).toContain('  - id: billing-feature\n');
  await inFolder(tree, async (folder) => {
    expect(lintFolder(folder)).toEqual([]);
    expect(checkStructure(folder)).toEqual([]);
    expect(await checkCommands(folder)).toEqual([]);
  });
});

test('a package needs types/, and names only known sections', () => {
  expect(parseSections('ui,types')).toEqual(['types', 'ui']);
  expect(() => parseSections('ui')).toThrow('A package needs `types/`');
  expect(() => parseSections('types,lib')).toThrow('Unknown sections: lib.');
});

test('a command needs its model, and a name that is taken fails', async () => {
  const tree = await workspace();
  addPackage(tree, { name: 'billing', sections: 'types,models,commands' });
  expect(() =>
    addCommand(tree, { package: 'billing', name: 'pay', model: 'invoice', waits: 'local' }),
  ).toThrow('packages/billing/models/invoice.ts does not exist.');
  expect(() => addPackage(tree, { name: 'billing', sections: 'types' })).toThrow(
    'packages/billing already exists.',
  );
  expect(() => addFeature(tree, { name: 'notes' })).toThrow(
    'already has the primitive `notes-feature`',
  );
});

test('a package owns no record until --record names one, and repo/ needs runtime/ and a record', async () => {
  const tree = await workspace();
  addPackage(tree, { name: 'email', sections: 'types,service,testing' });
  expect(tree.children('packages/email/types')).toEqual(['.gitkeep']);
  expect(tree.children('packages/email/service')).toEqual(['.gitkeep']);
  expect(tree.exists('packages/email/repo')).toBe(false);
  expect(() =>
    addPackage(tree, { name: 'ledger', sections: 'types,repo', record: 'entry' }),
  ).toThrow('A package with `repo/` needs `runtime/`.');
  expect(() => addPackage(tree, { name: 'ledger', sections: 'types,repo,runtime' })).toThrow(
    'Name the first one with `--record=<name>`.',
  );
  await inFolder(tree, (folder) => expect(checkStructure(folder)).toEqual([]));
});

test('a model gets a table only in a package with repo/, and only drizzle-kit writes migrations', async () => {
  const tree = await workspace();
  addPackage(tree, { name: 'ledger', sections: 'types,models,repo,runtime', record: 'entry' });
  addPackage(tree, { name: 'drafts', sections: 'types,models' });
  modelGenerator(tree, { package: 'ledger', name: 'account' });
  modelGenerator(tree, { package: 'drafts', name: 'draft' });
  expect(tree.read('packages/ledger/repo/schema.ts', 'utf-8')).toContain(
    "export const accountRecords = pgTable('account', {",
  );
  expect(tree.exists('packages/ledger/repo/account.ts')).toBe(true);
  expect(tree.exists('packages/drafts/repo')).toBe(false);
  await inFolder(tree, async (folder) => {
    expect(lintFolder(folder)).toEqual([]);
    expect(checkStructure(folder)).toEqual([]);
    await symlink(path.join(root, 'node_modules'), path.join(folder, 'node_modules'));
    const problems = checkDb(folder);
    expect(problems).toHaveLength(1);
    expect(problems[0]).toEndWith(
      'Run `mise exec -- bun nx run @repo/ledger:db-generate`, and commit the migration.',
    );
  });
});
