import { expect, test } from 'bun:test';
import { readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';

import { saveConfig } from '@/config';
import { gitOrThrow as git } from '@/git';
import { fakeBin } from '@/testing/fake-bin';
import { gitRepo } from '@/testing/git-repo';

const main = path.join(import.meta.dir, 'main.ts');

test('installation hands off to any interface without launching even a saved agent, and resumes each stage', async () => {
  await using project = await gitRepo({ 'package.json': '{"name":"shop"}' });
  await using bin = await fakeBin(['claude', 'codex'], { exitCode: 99 });
  const env = {
    ...process.env,
    FORCE_COLOR: undefined,
    PATH: `${bin.dir}${path.delimiter}${process.env.PATH}`,
    XDG_CONFIG_HOME: path.join(project.parent, 'config'),
  };
  await saveConfig(env, { agent: 'claude' });
  const run = async () => {
    const proc = Bun.spawn([process.execPath, main, '--yes'], {
      cwd: project.root,
      env,
      stdin: 'ignore',
      stdout: 'pipe',
      stderr: 'pipe',
    });
    const [stdout, stderr, code] = await Promise.all([
      new Response(proc.stdout).text(),
      new Response(proc.stderr).text(),
      proc.exited,
    ]);
    expect({ code, stderr }).toEqual({ code: 0, stderr: '' });
    return stdout;
  };

  const output = await run();
  expect(output).toContain(project.root);
  expect(output).toContain('survey stage');
  expect(await Bun.file(path.join(project.root, '.agents/skills/kickoff/SKILL.md')).exists()).toBe(
    true,
  );
  expect(await git(project.root, 'status', '--porcelain')).toBe('');
  expect(await git(project.root, 'branch', '--show-current')).toBe('template/install');

  const file = path.join(project.root, '.template-install/manifest.json');
  const manifest = JSON.parse(await readFile(file, 'utf-8'));
  for (const stage of ['interview', 'migrate']) {
    await writeFile(file, JSON.stringify({ ...manifest, stage }));
    await git(project.root, 'commit', '--quiet', '--all', '--message', `Stage ${stage}`);
    expect(await run()).toContain(`${stage} stage`);
    expect(JSON.parse(await readFile(file, 'utf-8')).stage).toBe(stage);
  }
  await git(project.root, 'rm', '--quiet', '-r', '.template-install');
  await git(project.root, 'commit', '--quiet', '--message', 'Migrate: remove the install folder');
  expect(await run()).toContain('Kickoff is done');
  expect(await bin.calls()).toEqual([]);
});
