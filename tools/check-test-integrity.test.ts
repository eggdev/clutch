import { expect, test } from 'bun:test';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { findBase } from '@tools/check-migrations';
import { checkTestIntegrity, countsOf, modulesOf } from '@tools/check-test-integrity';

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

const twoTests = [
  "test('a', () => { expect(add(1, 1)).toBe(2); });",
  "test('b', () => { expect(add(2, 2)).toBe(4); expect(add(0, 0)).toBe(0); });",
].join('\n');

/** A repository with tests on `origin/main`, then `change` applied in the working tree. */
async function changed(change: (root: string) => Promise<void>): Promise<Array<string>> {
  const root = await mkdtemp(path.join(tmpdir(), 'test-integrity-'));
  try {
    git(root, 'init', '-q', '-b', 'main');
    git(root, 'config', 'user.email', 'test@example.com');
    git(root, 'config', 'user.name', 'Test');
    for (const name of ['add', 'drop', 'keep', 'move']) {
      await write(root, `packages/a/service/${name}.ts`, 'export const add = 1;');
      await write(root, `packages/a/service/${name}.test.ts`, `// The ${name} tests.\n${twoTests}`);
    }
    await write(root, 'tools/test-integrity-allow.json', '{ "files": {} }');
    git(root, 'add', '-A');
    git(root, 'commit', '-qm', 'base');
    git(root, 'update-ref', 'refs/remotes/origin/main', 'HEAD');
    await change(root);
    git(root, 'add', '-A');
    return checkTestIntegrity(root, findBase(root));
  } finally {
    await rm(root, { recursive: true, force: true });
  }
}

test('a deleted test, a rename that does not run, and fewer tests or assertions fail', async () => {
  const problems = await changed(async (root) => {
    git(root, 'rm', '-q', 'packages/a/service/drop.test.ts');
    git(root, 'mv', 'packages/a/service/move.test.ts', 'packages/a/service/move.check.ts');
    await write(
      root,
      'packages/a/service/keep.test.ts',
      "test('a', () => { expect(1).toBe(1); });",
    );
    await write(
      root,
      'packages/a/service/add.test.ts',
      `${twoTests}\ntest('c', () => { expect(3).toBe(3); });`,
    );
  });
  expect(problems.map((problem) => problem.split('. ')[0])).toEqual([
    'packages/a/service/drop.test.ts: the change deletes it',
    'packages/a/service/keep.test.ts: tests 2 -> 1, assertions 3 -> 1',
    'packages/a/service/move.test.ts: the change renames it to packages/a/service/move.check.ts, which no test runner runs',
  ]);
});

test('a test deleted with its module, or listed with a reason, passes; an empty reason fails', async () => {
  expect(
    await changed(async (root) => {
      git(root, 'rm', '-q', 'packages/a/service/drop.test.ts', 'packages/a/service/drop.ts');
      git(root, 'rm', '-q', 'packages/a/service/keep.test.ts');
      await write(
        root,
        'tools/test-integrity-allow.json',
        JSON.stringify({
          files: { 'packages/a/service/keep.test.ts': 'A journey in apps/web covers it.' },
        }),
      );
    }),
  ).toEqual([]);
  expect(
    await changed(async (root) => {
      git(root, 'rm', '-q', 'packages/a/service/keep.test.ts');
      await write(
        root,
        'tools/test-integrity-allow.json',
        JSON.stringify({ files: { 'packages/a/service/keep.test.ts': ' ' } }),
      );
    }),
  ).toEqual([
    'tools/test-integrity-allow.json: `packages/a/service/keep.test.ts` has no reason. Say why the test can go.',
  ]);
});

test('tests and assertions are counted by call, and a test names the module it tests', () => {
  expect(
    countsOf(
      "test('a', () => { expect(x).toBe(1); });\ntest.each([1])('b', () => { expectSynced(); });\nit('c', () => { assertShape(); pattern.test(y); });",
    ),
  ).toEqual({ tests: 3, assertions: 3 });
  expect(modulesOf('packages/a/runtime/pool.test.ts')).toContain('packages/a/runtime/pool.ts');
  expect(modulesOf('apps/web/e2e/notes.pw.ts')).toEqual([]);
});
