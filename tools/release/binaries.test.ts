import { expect, test } from 'bun:test';
import { copyFile, mkdir, mkdtemp, readFile, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { buildBinaries } from '@tools/release/binaries';

const root = path.resolve(import.meta.dir, '../..');

const issue = `---
id: CL-001
title: 'Ship the shop'
phase: P0
status: todo
depends_on: []
pr: ''
owner: agent
---

# CL-001: Ship the shop
`;

function run(cmd: Array<string>, cwd: string, PATH: string) {
  const proc = Bun.spawnSync(cmd, { cwd, env: { ...process.env, PATH } });
  return { code: proc.exitCode, out: `${proc.stdout}${proc.stderr}` };
}

/** A project from Clutch: the tracker, the launcher and its own formatter, but no `apps/cli/`. */
async function project(parent: string) {
  const dir = path.join(parent, 'shop');
  await mkdir(path.join(dir, '.clutch/issues'), { recursive: true });
  await mkdir(path.join(dir, 'tools'));
  await mkdir(path.join(dir, 'node_modules/.bin'), { recursive: true });
  await writeFile(path.join(dir, '.clutch/issues/CL-001.md'), issue);
  await copyFile(path.join(root, 'tools/clutch.ts'), path.join(dir, 'tools/clutch.ts'));
  await copyFile(path.join(root, '.oxfmtrc.json'), path.join(dir, '.oxfmtrc.json'));
  await symlink(path.join(root, 'node_modules/oxfmt'), path.join(dir, 'node_modules/oxfmt'));
  await symlink('../oxfmt/bin/oxfmt', path.join(dir, 'node_modules/.bin/oxfmt'));
  return dir;
}

test('a project runs the tracker commands through the launcher and the release binary', async () => {
  const parent = await mkdtemp(path.join(tmpdir(), 'clutch-binary-'));
  try {
    const [archive] = await buildBinaries(root, path.join(parent, 'dist'), [
      `${process.platform}-${process.arch}`,
    ]);
    const bin = path.join(parent, 'bin');
    await mkdir(bin);
    expect(run(['tar', '-xzf', archive, '-C', bin], parent, process.env.PATH ?? '').code).toBe(0);
    const dir = await project(parent);
    const PATH = `${bin}${path.delimiter}${process.env.PATH}`;
    const clutch = (...args: Array<string>) =>
      run([process.execPath, 'tools/clutch.ts', ...args], dir, PATH);

    expect(clutch('issues', 'set', 'CL-001', 'in_progress')).toMatchObject({ code: 0 });
    expect(await readFile(path.join(dir, '.clutch/TRACKER.md'), 'utf-8')).toContain('in_progress');
    expect(clutch('issues', '--check')).toEqual({ code: 0, out: '' });
    expect(clutch('issues', 'next').out).toBe('No unblocked issue.\n');
    const doctor = clutch('doctor');
    expect(doctor.code).toBe(1);
    expect(doctor.out).toContain('clutch doctor runs from a Clutch clone.');

    const bare = run(
      [process.execPath, 'tools/clutch.ts', 'issues'],
      dir,
      path.dirname(process.execPath),
    );
    expect(bare.code).toBe(1);
    expect(bare.out).toContain('The clutch binary is not installed.');
  } finally {
    await rm(parent, { recursive: true, force: true });
  }
}, 30_000);
