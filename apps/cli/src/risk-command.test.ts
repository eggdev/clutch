import { expect, test } from 'bun:test';
import { readFile } from 'node:fs/promises';
import path from 'node:path';

import { cliRoot } from '@/format';
import { gitOrThrow } from '@/git';
import { gitRepo } from '@/testing/git-repo';

const main = path.join(import.meta.dir, 'main.ts');

async function clutchRisk(root: string, ...args: Array<string>) {
  const proc = Bun.spawn([process.execPath, main, 'risk', ...args], {
    cwd: root,
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

const read = (file: string) => readFile(path.join(cliRoot, file), 'utf-8');

/** A repo with Clutch's own risk rules and guardrail list, and a `change` branch that adds `files`. */
async function changeOf(files: Array<string>) {
  const repo = await gitRepo({
    '.clutch/risk.yaml': await read('.clutch/risk.yaml'),
    'tools/guardrail-files.json': await read('tools/guardrail-files.json'),
  });
  await gitOrThrow(repo.root, 'switch', '--quiet', '--create', 'change');
  await repo.write(Object.fromEntries(files.map((file) => [file, 'changed\n'])));
  await gitOrThrow(repo.root, 'add', '--all');
  await gitOrThrow(repo.root, 'commit', '--quiet', '--message', 'Change');
  return repo;
}

async function tierOf(files: Array<string>) {
  await using repo = await changeOf(files);
  const result = await clutchRisk(repo.root, '--base', 'main', '--json');
  expect(result.code).toBe(0);
  return JSON.parse(result.stdout).tier;
}

test('a docs-only change is low', async () => {
  expect(
    await tierOf([
      'docs/contributing/review-notes.md',
      '.changeset/quiet-fox.md',
      'apps/cli/README.md',
    ]),
  ).toBe('low');
});

test('tests alone are low, and app code is medium', async () => {
  expect(await tierOf(['apps/cli/src/risk/tiers.test.ts'])).toBe('low');
  expect(await tierOf(['apps/cli/src/risk/tiers.ts', 'docs/a.md'])).toBe('medium');
});

test('a workflow, agent steering, a migration or auth code is a one-way door', async () => {
  for (const file of [
    '.github/workflows/ci.yml',
    'AGENTS.md',
    '.agents/skills/deliver/SKILL.md',
    'packages/access/repo/migrations/20261030000000_x/migration.sql',
    'packages/identity/service/actors.ts',
    '.github/CODEOWNERS',
  ]) {
    expect(await tierOf([file, 'docs/a.md'])).toBe('one-way-door');
  }
});

test('the lockfile, the sync engine and an unlisted path are high', async () => {
  expect(await tierOf(['bun.lock'])).toBe('high');
  expect(await tierOf(['packages/sync/service/push.ts'])).toBe('high');
  expect(await tierOf(['vite.config.ts'])).toBe('high');
});

test('the text output names the files at the change tier and the pattern that set it', async () => {
  await using repo = await changeOf(['apps/web/src/app.ts', 'docs/a.md']);
  const result = await clutchRisk(repo.root, '--base', 'main');
  expect(result).toMatchObject({
    code: 0,
    stdout: 'risk/medium\n  apps/web/src/app.ts  (apps/**)\n',
  });
});

test('a missing risk file is an error that says so', async () => {
  await using repo = await gitRepo({ 'docs/a.md': 'a\n' });
  const result = await clutchRisk(repo.root, '--base', 'main', '--json');
  expect(result.code).toBe(1);
  expect(JSON.parse(result.stdout)).toMatchObject({
    status: 'error',
    message: '.clutch/risk.yaml is missing. Copy it from the Clutch template.',
  });
});
