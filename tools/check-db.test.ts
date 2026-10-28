import { expect, test } from 'bun:test';
import { symlink, writeFile } from 'node:fs/promises';
import path from 'node:path';

import { checkDb } from '@tools/check-db';
import { inRepo } from '@tools/testing/in-repo';

const repoRoot = path.resolve(import.meta.dir, '..');
const config = [
  "import { defineConfig } from 'drizzle-kit';",
  '',
  "export default defineConfig({ dialect: 'postgresql', schema: './repo/schema.ts', out: './repo/migrations' });",
  '',
].join('\n');
const schema = (columns: string) =>
  [
    "import { pgTable, text } from 'drizzle-orm/pg-core';",
    '',
    `export const items = pgTable('items', { id: text('id').primaryKey()${columns} });`,
    '',
  ].join('\n');

test('a hand-written migration or a changed folder fails with the fix', async () => {
  const problems = await inRepo(
    {
      'packages/demo/drizzle.config.ts': config,
      'packages/demo/repo/migrations/0001_init.sql': 'select 1;',
      'packages/demo/repo/migrations/20261028120000_init/migration.sql': 'select 1;',
      'packages/demo/repo/migrations/20261028120000_init/notes.md': 'extra',
      'packages/demo/repo/migrations/20261028120000_init/snapshot.json': '{}',
      'packages/demo/repo/migrations/.gitkeep': '',
      'packages/plain/package.json': '{}',
    },
    checkDb,
  );
  expect(problems).toEqual([
    'packages/demo/repo/migrations/0001_init.sql: drizzle-kit did not write this. Delete it, change `repo/schema.ts`, and run `mise exec -- bun nx run @repo/<package>:db-generate`.',
    'packages/demo/repo/migrations/20261028120000_init: holds migration.sql, notes.md, snapshot.json, but drizzle-kit writes only migration.sql and snapshot.json. Restore the folder from main, or generate a new migration.',
  ]);
});

test('a schema change with no migration fails, and passes once drizzle-kit writes one', async () => {
  const results = await inRepo(
    {
      'packages/demo/drizzle.config.ts': config,
      'packages/demo/repo/schema.ts': schema(''),
      'packages/demo/repo/migrations/.gitkeep': '',
    },
    async (root) => {
      await symlink(path.join(repoRoot, 'node_modules'), path.join(root, 'node_modules'));
      const generate = () =>
        Bun.spawnSync([path.join(root, 'node_modules/.bin/drizzle-kit'), 'generate'], {
          cwd: path.join(root, 'packages/demo'),
        });
      generate();
      const clean = checkDb(root);
      await writeFile(
        path.join(root, 'packages/demo/repo/schema.ts'),
        schema(", title: text('title')"),
      );
      const changed = checkDb(root);
      generate();
      return { clean, changed, regenerated: checkDb(root) };
    },
  );
  expect(results.clean).toEqual([]);
  expect(results.changed).toHaveLength(1);
  expect(results.changed[0]).toStartWith('packages/demo: The schema differs from the migrations.');
  expect(results.changed[0]).toEndWith(
    'Run `mise exec -- bun nx run @repo/demo:db-generate`, and commit the migration.',
  );
  expect(results.regenerated).toEqual([]);
});
