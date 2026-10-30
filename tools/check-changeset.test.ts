import { expect, test } from 'bun:test';
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { checkChangeset } from '@tools/check-changeset';
import { changesetText } from '@tools/release/changeset';

function git(root: string, ...args: Array<string>) {
  return Bun.spawnSync(['git', '-C', root, ...args])
    .stdout.toString()
    .trim();
}

async function repo() {
  const root = await mkdtemp(path.join(tmpdir(), 'changeset-check-'));
  git(root, 'init', '--quiet', '--initial-branch=main');
  git(root, 'config', 'user.email', 't@t');
  git(root, 'config', 'user.name', 't');
  await writeFile(path.join(root, 'README.md'), '# r\n');
  git(root, 'add', '--all');
  git(root, 'commit', '--quiet', '--no-verify', '-m', 'base');
  return { root, base: git(root, 'rev-parse', 'HEAD') };
}

test('a change without a changeset fails, and one with a changeset passes', async () => {
  const { root, base } = await repo();
  try {
    await writeFile(path.join(root, 'tool.ts'), 'export {};\n');
    expect(await checkChangeset(root, base)).toHaveLength(1);
    await mkdir(path.join(root, '.changeset'));
    await writeFile(path.join(root, '.changeset/x.md'), changesetText('patch', 'fix: x'));
    expect(await checkChangeset(root, base)).toEqual([]);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test('a tracker-only change, no change and no base need no changeset', async () => {
  const { root, base } = await repo();
  try {
    expect(await checkChangeset(root, base)).toEqual([]);
    await mkdir(path.join(root, '.clutch/issues'), { recursive: true });
    await writeFile(path.join(root, '.clutch/issues/CL-001.md'), '---\n');
    expect(await checkChangeset(root, base)).toEqual([]);
    await writeFile(path.join(root, 'tool.ts'), 'export {};\n');
    expect(await checkChangeset(root, null)).toEqual([]);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
