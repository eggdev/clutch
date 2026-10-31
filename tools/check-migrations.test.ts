import { expect, test } from 'bun:test';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { findBase } from '@tools/check-base';
import { checkMigrations } from '@tools/check-migrations';

function git(root: string, ...args: Array<string>) {
  const run = Bun.spawnSync(['git', '-C', root, ...args]);
  if (run.exitCode !== 0) {
    throw new Error(run.stderr.toString());
  }
}

async function write(root: string, file: string, content: string) {
  await mkdir(path.join(root, path.dirname(file)), { recursive: true });
  await writeFile(path.join(root, file), content);
}

test('a merged migration cannot change, move or go away, and a new one or the journal can change', async () => {
  const root = await mkdtemp(path.join(tmpdir(), 'migrations-'));
  try {
    git(root, 'init', '-q', '-b', 'main');
    git(root, 'config', 'user.email', 'test@example.com');
    git(root, 'config', 'user.name', 'Test');
    await write(root, 'packages/a/migrations/0001.sql', 'create table a;');
    await write(root, 'packages/a/migrations/0002.sql', 'create table b;');
    await write(root, 'packages/a/migrations/0003.sql', 'create table c;');
    await write(root, 'packages/a/migrations/meta/_journal.json', '{"entries":3}');
    await write(root, 'packages/a/src/index.ts', 'export {};');
    git(root, 'add', '-A');
    git(root, 'commit', '-qm', 'base');
    git(root, 'update-ref', 'refs/remotes/origin/main', 'HEAD');

    await write(root, 'packages/a/migrations/0001.sql', 'create table a2;');
    git(root, 'rm', '-q', 'packages/a/migrations/0002.sql');
    git(root, 'mv', 'packages/a/migrations/0003.sql', 'packages/a/migrations/0003-c.sql');
    await write(root, 'packages/a/migrations/0004.sql', 'create table d;');
    await write(root, 'packages/a/migrations/meta/_journal.json', '{"entries":4}');
    await write(root, 'packages/a/src/index.ts', 'export const a = 1;');
    git(root, 'add', '-A');

    expect(checkMigrations(root, findBase(root))).toEqual([
      'packages/a/migrations/0001.sql is changed. It reached main, so it never changes.',
      'packages/a/migrations/0002.sql is deleted. It reached main, so it never changes.',
      'packages/a/migrations/0003.sql is renamed to packages/a/migrations/0003-c.sql. It reached main, so it never changes.',
    ]);
    expect(() => findBase(root, 'not-a-commit')).toThrow('CHECK_BASE is not-a-commit');
    expect(findBase(root, '0000000000000000000000000000000000000000')).toBeNull();
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test('a repository with no origin/main has no merged migrations', async () => {
  const root = await mkdtemp(path.join(tmpdir(), 'migrations-'));
  try {
    git(root, 'init', '-q', '-b', 'main');
    expect(findBase(root)).toBeNull();
    expect(checkMigrations(root, null)).toEqual([]);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
