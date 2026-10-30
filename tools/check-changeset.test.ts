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
  await writeFile(
    path.join(root, 'package.json'),
    JSON.stringify({ name: 'shop', version: '0.0.0' }),
  );
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
    await writeFile(path.join(root, '.changeset/x.md'), changesetText('shop', 'patch', 'fix: x'));
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

const bot = '41898282+github-actions[bot]@users.noreply.github.com';

/** A repo whose base commit holds a pending changeset, as main does before a release. */
async function pending() {
  const { root } = await repo();
  await mkdir(path.join(root, '.changeset'));
  await writeFile(path.join(root, '.changeset/x.md'), changesetText('shop', 'patch', 'fix: x'));
  await writeFile(path.join(root, 'CHANGELOG.md'), '# Changelog\n');
  git(root, 'add', '--all');
  git(root, 'commit', '--quiet', '--no-verify', '-m', 'feat: x');
  return { root, base: git(root, 'rev-parse', 'HEAD') };
}

/** Writes what release.yml writes: a version bump and a changelog section. */
async function bump(root: string) {
  await writeFile(
    path.join(root, 'package.json'),
    JSON.stringify({ name: 'shop', version: '0.0.1' }),
  );
  await writeFile(path.join(root, 'CHANGELOG.md'), '# Changelog\n\n## 0.0.1\n\n- fix: x\n');
}

function commitAs(root: string, email: string, subject: string) {
  git(root, 'add', '--all');
  git(
    root,
    '-c',
    `user.email=${email}`,
    '-c',
    'user.name=github-actions[bot]',
    'commit',
    '--quiet',
    '--no-verify',
    '-m',
    subject,
  );
}

test('a release commit that consumes the changesets needs none', async () => {
  const { root, base } = await pending();
  try {
    await bump(root);
    await rm(path.join(root, '.changeset/x.md'));
    commitAs(root, bot, 'chore(release): v0.0.1');
    expect(await checkChangeset(root, base)).toEqual([]);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test('a range that only consumes changesets needs none, whoever commits it', async () => {
  const { root, base } = await pending();
  try {
    await bump(root);
    await rm(path.join(root, '.changeset/x.md'));
    commitAs(root, 't@t', 'chore: release by hand');
    expect(await checkChangeset(root, base)).toEqual([]);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test('a range of release commits by the release job needs none', async () => {
  const { root, base } = await pending();
  try {
    await bump(root);
    commitAs(root, bot, 'chore(release): v0.0.1');
    expect(await checkChangeset(root, base)).toEqual([]);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test('a pull request without a changeset still fails when it looks like a release', async () => {
  const { root, base } = await pending();
  try {
    // A person's commit with the release subject is not a release.
    await bump(root);
    commitAs(root, 't@t', 'chore(release): v0.0.1');
    expect(await checkChangeset(root, base)).toHaveLength(1);
    // Code next to the release output is never a release, even from the job.
    await writeFile(path.join(root, 'tool.ts'), 'export {};\n');
    await rm(path.join(root, '.changeset/x.md'));
    commitAs(root, bot, 'chore(release): v0.0.2');
    expect(await checkChangeset(root, base)).toHaveLength(1);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
