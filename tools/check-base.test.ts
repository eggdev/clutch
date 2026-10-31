import { expect, test } from 'bun:test';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { changedFiles, defaultBranchBase, findBase } from '@tools/check-base';

function git(root: string, ...args: Array<string>) {
  return Bun.spawnSync(['git', '-C', root, '-c', 'user.name=t', '-c', 'user.email=t@t', ...args])
    .stdout.toString()
    .trim();
}

/** A clone whose origin/main is one commit behind HEAD. */
async function clone() {
  const parent = await mkdtemp(path.join(tmpdir(), 'check-base-'));
  const origin = path.join(parent, 'origin');
  git(parent, 'init', '--quiet', '--initial-branch=main', origin);
  await writeFile(path.join(origin, 'a.txt'), 'a\n');
  git(origin, 'add', '--all');
  git(origin, 'commit', '--quiet', '--message', 'base');
  const root = path.join(parent, 'work');
  git(parent, 'clone', '--quiet', origin, root);
  await writeFile(path.join(root, 'b.txt'), 'b\n');
  git(root, 'add', '--all');
  git(root, 'commit', '--quiet', '--message', 'change');
  return { parent, root, base: git(origin, 'rev-parse', 'HEAD') };
}

test('the base is CHECK_BASE, or else the merge base with the remote default branch', async () => {
  const { parent, root, base } = await clone();
  try {
    expect(findBase(root)).toBe(base);
    expect(defaultBranchBase(root)).toBe(base);
    expect(findBase(root, 'HEAD')).toBe(git(root, 'rev-parse', 'HEAD'));
    expect(findBase(root, '0'.repeat(40))).toBeNull();
    expect(() => findBase(root, 'nope')).toThrow('CHECK_BASE is nope');
  } finally {
    await rm(parent, { recursive: true, force: true });
  }
});

test('the changed files hold commits, edits and untracked files', async () => {
  const { parent, root, base } = await clone();
  try {
    await writeFile(path.join(root, 'a.txt'), 'edited\n');
    await writeFile(path.join(root, 'c.txt'), 'new\n');
    expect(changedFiles(root, base)?.toSorted()).toEqual(['a.txt', 'b.txt', 'c.txt']);
  } finally {
    await rm(parent, { recursive: true, force: true });
  }
});

test('a repository with no remote has no base', async () => {
  const parent = await mkdtemp(path.join(tmpdir(), 'check-base-'));
  try {
    git(parent, 'init', '--quiet', '--initial-branch=main');
    expect(findBase(parent)).toBeNull();
  } finally {
    await rm(parent, { recursive: true, force: true });
  }
});
