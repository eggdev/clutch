import { expect, test } from 'bun:test';
import { readdir } from 'node:fs/promises';
import path from 'node:path';

import { gitRepo } from '@/testing/git-repo';

const main = path.join(import.meta.dir, 'main.ts');
const fixtures = path.join(import.meta.dir, 'factory/fixtures');

async function clutch(cwd: string, ...args: Array<string>) {
  const proc = Bun.spawn([process.execPath, main, 'factory', ...args], {
    cwd,
    stdout: 'pipe',
    stderr: 'pipe',
  });
  const [stdout, stderr, code] = await Promise.all([
    new Response(proc.stdout).text(),
    new Response(proc.stderr).text(),
    proc.exited,
  ]);
  return { stdout, stderr, code };
}

const config = (extra = '') =>
  `schemaVersion: 1\nproject: shop\ntemplate:\n  repo: eggdev/clutch\n  mode: sync\ncapabilities: {}\n${extra}`;

test('a project with no tree passes with a notice', async () => {
  await using repo = await gitRepo({ 'clutch.yaml': config() });
  expect(await clutch(repo.root, '--check')).toEqual({
    code: 0,
    stdout: 'No factory tree at factory/. Nothing to check.\n',
    stderr: '',
  });
});

test('a factory.root that names a missing folder fails', async () => {
  await using repo = await gitRepo({ 'clutch.yaml': config('factory:\n  root: gone\n') });
  const result = await clutch(repo.root, '--check');
  expect(result.code).toBe(1);
  expect(result.stdout).toBe('');
  expect(result.stderr).toContain('gone/ is not a folder.');
});

test('factory.root in clutch.yaml moves the tree, and a problem names the file and the key', async () => {
  await using repo = await gitRepo({
    'clutch.yaml': config('factory:\n  root: .\n'),
    'agents/implement/agent.md':
      '---\nrole: implement\ndescription: An agent.\nharness: claude\nmodel: opus\nrunner: gpu\nteam: core\n---\n\nWork.\n',
    'models.yaml': 'models:\n  - id: opus\n    harness: claude\n',
  });
  const result = await clutch(path.join(repo.root, 'agents'), '--check');
  expect(result.code).toBe(1);
  expect(result.stderr).toContain('agents/implement/agent.md: team: Unknown key.');
  expect(result.stderr).toContain('agents/implement/agent.md: runner: No file runners/gpu.yaml.');
});

test('--root checks one tree, and --json prints the problems', async () => {
  const good = await clutch(fixtures, '--check', '--root', 'good');
  expect(good).toMatchObject({ code: 0, stderr: '' });
  expect(good.stdout).toBe(
    'The factory tree at good/ passes: 3 agents, 1 automation, 1 runner, 1 scorer, 1 benchmark, models.yaml.\n',
  );
  const bad = await clutch(fixtures, '--check', '--root', 'missing-runner', '--json');
  expect(bad.code).toBe(1);
  expect(JSON.parse(bad.stdout).problems).toEqual([
    {
      file: 'missing-runner/agents/implement/agent.md',
      key: 'runner',
      reason: 'No file runners/gpu-box.yaml.',
    },
  ]);
  expect(await clutch(fixtures, '--check', '--root', 'nowhere')).toMatchObject({ code: 1 });
});

test('--write-schemas writes a JSON Schema file for each kind', async () => {
  await using dir = await gitRepo({}, { git: false });
  expect(await clutch(dir.root, '--write-schemas', 'out')).toMatchObject({ code: 0 });
  const written = await readdir(path.join(dir.root, 'out'));
  expect(written.toSorted()).toEqual([
    'agent.schema.json',
    'automation.schema.json',
    'benchmark.schema.json',
    'models.schema.json',
    'runner.schema.json',
    'scorer.schema.json',
  ]);
});
