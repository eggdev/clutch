import { expect, test } from 'bun:test';
import { readFile } from 'node:fs/promises';
import path from 'node:path';

import { detect } from '@/doctor/detect';
import { loadRegistry } from '@/doctor/registry';
import { gitOrThrow } from '@/git';
import { gitRepo } from '@/testing/git-repo';

const main = path.join(import.meta.dir, 'main.ts');
const clutchRoot = path.resolve(import.meta.dir, '../../..');

async function clutch(root: string, ...args: Array<string>) {
  const proc = Bun.spawn([process.execPath, main, 'ratchet', ...args], {
    cwd: root,
    stdout: 'pipe',
    stderr: 'pipe',
    env: { ...process.env, CHECK_BASE: '' },
  });
  const [stdout, stderr, code] = await Promise.all([
    new Response(proc.stdout).text(),
    new Response(proc.stderr).text(),
    proc.exited,
  ]);
  return { stdout, stderr, code };
}

const todo = (count: number) => `${'// TODO\n'.repeat(count)}export {};\n`;

test('add seeds the counts, check fails on a raise, and exits 2 on a drop until update', async () => {
  await using repo = await gitRepo({ 'src/a.ts': todo(2) });
  expect(
    await clutch(repo.root, 'add', 'todo', '--pattern', 'TODO', '--files', 'src/**/*.ts'),
  ).toMatchObject({
    code: 0,
  });
  const file = JSON.parse(await readFile(path.join(repo.root, '.clutch/ratchets.json'), 'utf-8'));
  expect(file.ratchets.todo.counts).toEqual({ 'src/a.ts': 2 });
  await gitOrThrow(repo.root, 'add', '--all');
  await gitOrThrow(repo.root, 'commit', '--quiet', '--message', 'Ratchet');
  const base = await gitOrThrow(repo.root, 'rev-parse', 'HEAD');

  await repo.write({ 'src/a.ts': todo(3) });
  const raised = await clutch(repo.root, 'check', '--base', base);
  expect(raised.code).toBe(1);
  expect(raised.stdout).toContain('src/a.ts has 3, more than 2 in the baseline.');

  await repo.write({ 'src/a.ts': todo(1) });
  const dropped = await clutch(repo.root, 'check', '--base', base);
  expect(dropped.code).toBe(2);
  expect(dropped.stdout).toContain('Run clutch ratchet update');
  expect(await clutch(repo.root, 'update')).toMatchObject({ code: 0 });
  expect(await clutch(repo.root, 'check', '--base', base)).toMatchObject({ code: 0 });
});

test('update refuses a raise, and leaves the baseline as it was', async () => {
  await using repo = await gitRepo({ 'src/a.ts': todo(1) });
  await clutch(repo.root, 'add', 'todo', '--pattern', 'TODO', '--files', 'src/**/*.ts');
  await repo.write({ 'src/a.ts': todo(2) });
  const result = await clutch(repo.root, 'update');
  expect(result.code).toBe(1);
  expect(result.stderr).toContain('A ratchet only goes down.');
  const file = JSON.parse(await readFile(path.join(repo.root, '.clutch/ratchets.json'), 'utf-8'));
  expect(file.ratchets.todo.counts).toEqual({ 'src/a.ts': 1 });
});

test('an empty ratchets object reads as missing, and a ratchet with its target as present', async () => {
  const registry = await loadRegistry(clutchRoot);
  const entry = (registry.capabilities ?? []).filter((item) => item.id === 'ratchets');
  const target = JSON.stringify({ name: 'x', nx: { targets: { 'check-ratchets': {} } } });
  await using empty = await gitRepo({
    'package.json': target,
    '.clutch/ratchets.json': '{"schemaVersion":1,"ratchets":{}}',
  });
  const [fromEmpty] = await detect(empty.root, entry);
  expect(fromEmpty.status).not.toBe('present');
  await using real = await gitRepo({
    'package.json': target,
    '.clutch/ratchets.json': JSON.stringify({
      schemaVersion: 1,
      ratchets: { cast: { pattern: 'as any', files: '**/*.ts', counts: {} } },
    }),
  });
  const [fromReal] = await detect(real.root, entry);
  expect(fromReal.status).toBe('present');
});
