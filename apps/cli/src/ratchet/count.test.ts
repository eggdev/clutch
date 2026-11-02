import { expect, test } from 'bun:test';

import { gitOrThrow } from '@/git';
import { readRatchets, writeRatchets } from '@/ratchet/config';
import { checkRatchet, countNow } from '@/ratchet/count';
import { gitRepo } from '@/testing/git-repo';

const ratchet = { pattern: 'TODO', files: 'src/**/*.ts', counts: { 'src/a.ts': 2 } };

test('a pattern ratchet counts the tracked files that its glob matches', async () => {
  await using repo = await gitRepo({
    'src/a.ts': '// TODO one\n// TODO two\n',
    'src/b.ts': 'clean\n',
    'docs/c.md': 'TODO not counted\n',
  });
  expect(await countNow(repo.root, ratchet)).toEqual({ 'src/a.ts': 2 });
});

test('the check compares a touched file with the merge base', async () => {
  await using repo = await gitRepo({ 'src/a.ts': '// TODO one\n// TODO two\n' });
  const base = await gitOrThrow(repo.root, 'rev-parse', 'HEAD');
  expect(await checkRatchet(repo.root, ratchet, base)).toMatchObject({ code: 0 });
  await repo.write({ 'src/a.ts': '// TODO one\n// TODO two\n// TODO three\n' });
  const raised = await checkRatchet(repo.root, ratchet, base);
  expect(raised.code).toBe(1);
  // One finding for each file: a raise over the baseline is also over the base.
  expect(raised.raised).toEqual([{ path: 'src/a.ts', from: 2, to: 3, against: 'baseline' }]);
});

test('a command ratchet reads path:count lines and compares with the baseline', async () => {
  await using repo = await gitRepo({ 'README.md': '# x\n' });
  const command = { command: "printf 'src/a.ts:1\\n'", files: 'src/**', counts: { 'src/a.ts': 2 } };
  expect(await checkRatchet(repo.root, command, null)).toMatchObject({ code: 2 });
});

test('a repository with no ratchets file has no ratchets, and a write sorts the counts', async () => {
  await using repo = await gitRepo({ 'README.md': '# x\n' });
  expect(await readRatchets(repo.root)).toEqual({ schemaVersion: 1, ratchets: {} });
  await writeRatchets(repo.root, {
    schemaVersion: 1,
    ratchets: { todo: { ...ratchet, counts: { 'src/z.ts': 1, 'src/a.ts': 2 } } },
  });
  const read = await readRatchets(repo.root);
  expect(Object.keys(read.ratchets.todo.counts)).toEqual(['src/a.ts', 'src/z.ts']);
});
