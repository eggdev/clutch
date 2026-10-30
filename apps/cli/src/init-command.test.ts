import { expect, test } from 'bun:test';
import { readFile } from 'node:fs/promises';
import path from 'node:path';

import { parse } from 'yaml';

import { doctorCommand } from '@/doctor-command';
import { cliRoot } from '@/format';
import { initCommand } from '@/init-command';
import { lineagePath } from '@/sync/source';
import { gitRepo } from '@/testing/git-repo';

/** Runs `fn` with console.log captured. */
async function quiet<T>(fn: () => Promise<T>) {
  const { log } = console;
  console.log = () => {};
  try {
    return await fn();
  } finally {
    console.log = log;
  }
}

test('init writes clutch.yaml, the tracker and the baseline, and doctor --check then passes', async () => {
  await using repo = await gitRepo({ 'AGENTS.md': '# Agents\n', 'package.json': '{}' });
  expect(await quiet(() => initCommand(['--yes'], repo.root))).toBe(0);
  const config = parse(await readFile(path.join(repo.root, 'clutch.yaml'), 'utf-8'));
  expect(config).toMatchObject({
    schemaVersion: 1,
    template: { repo: expect.any(String), mode: 'sync' },
  });
  expect(config.template).not.toHaveProperty('commit');
  expect(config.capabilities.root_agents_md).toBe('adopted');
  expect(config.capabilities.codeql_sast).toEqual({
    status: 'waived',
    reason: 'Decide during adoption.',
  });
  for (const file of ['.clutch/README.md', '.clutch/TRACKER.md', '.clutch/doctor-baseline.json']) {
    expect(await Bun.file(path.join(repo.root, file)).exists()).toBe(true);
  }
  expect(await Bun.file(path.join(repo.root, lineagePath)).exists()).toBe(false);
  expect(await quiet(() => doctorCommand(['--check'], repo.root))).toBe(0);
});

test('init refuses a repository that already has clutch.yaml', async () => {
  await using repo = await gitRepo({ 'clutch.yaml': 'schemaVersion: 1\n' });
  const errors: Array<string> = [];
  const { error } = console;
  console.error = (line: string) => errors.push(line);
  try {
    expect(await initCommand(['--yes'], repo.root)).toBe(1);
  } finally {
    console.error = error;
  }
  expect(errors).toEqual([
    `${repo.root} already has clutch.yaml. Use clutch sync or clutch doctor instead.`,
  ]);
});

test('doctor mode writes no lineage, even with --adopt', async () => {
  await using repo = await gitRepo({ 'package.json': '{}' });
  expect(await quiet(() => initCommand(['--yes', '--mode', 'doctor', '--adopt'], repo.root))).toBe(
    0,
  );
  expect(parse(await readFile(path.join(repo.root, 'clutch.yaml'), 'utf-8')).template.mode).toBe(
    'doctor',
  );
  expect(await Bun.file(path.join(repo.root, lineagePath)).exists()).toBe(false);
});

test('--adopt records a file that matches an earlier Clutch version, and leaves an edited one out', async () => {
  const editorconfig = await readFile(path.join(cliRoot, '.editorconfig'), 'utf-8');
  await using repo = await gitRepo({
    '.editorconfig': editorconfig,
    '.oxfmtrc.json': '{ "printWidth": 80 }\n',
    'package.json': '{}',
  });
  expect(await quiet(() => initCommand(['--yes', '--adopt'], repo.root))).toBe(0);
  const { files } = JSON.parse(await readFile(path.join(repo.root, lineagePath), 'utf-8'));
  expect(Object.keys(files)).toContain('.editorconfig');
  expect(Object.keys(files)).not.toContain('.oxfmtrc.json');
});
