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
async function changeOf(files: Array<string> | Record<string, string>) {
  const repo = await gitRepo({
    '.clutch/risk.yaml': await read('.clutch/risk.yaml'),
    'tools/guardrail-files.json': await read('tools/guardrail-files.json'),
  });
  await gitOrThrow(repo.root, 'switch', '--quiet', '--create', 'change');
  await repo.write(
    Array.isArray(files) ? Object.fromEntries(files.map((file) => [file, 'changed\n'])) : files,
  );
  await gitOrThrow(repo.root, 'add', '--all');
  await gitOrThrow(repo.root, 'commit', '--quiet', '--message', 'Change');
  return repo;
}

async function tierOf(files: Array<string> | Record<string, string>) {
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
  expect(await tierOf(['apps/cli/src/worktree/new.ts', 'docs/a.md'])).toBe('medium');
});

test('the hard core is a one-way door: the merge gate, auth, migrations and policy docs', async () => {
  for (const file of [
    '.github/rulesets/main.json',
    '.github/CODEOWNERS',
    'tools/github/auto-merge.ts',
    'tools/github/bot-rule.ts',
    '.github/workflows/agent-review.yml',
    'docs/contributing/review.md',
    'apps/cli/src/risk/tiers.ts',
    'packages/identity/service/actors.ts',
    'packages/access/service/access.ts',
    'apps/api/src/auth/session.ts',
    'packages/access/repo/migrations/20261030000000_x/migration.sql',
    'docs/contributing/decisions/0001-a.md',
    'docs/principles/fail-loudly.md',
    '.clutch/PLAN.md',
  ]) {
    expect(await tierOf([file, 'docs/a.md'])).toBe('one-way-door');
  }
});

test('skills, check scripts, lint config, workflows and any unlisted path are medium or low', async () => {
  for (const file of [
    '.github/workflows/ci.yml',
    'tools/check-workflows.ts',
    'tools/github/pr.ts',
    'oxlint.config.ts',
    'package.json',
    'clutch.yaml',
    'apps/web/src/app.tsx',
    'packages/sync/service/push.ts',
    'bun.lock',
    'vite.config.ts',
  ]) {
    expect(await tierOf([file, 'docs/a.md'])).toBe('medium');
  }
  expect(await tierOf(['AGENTS.md', '.agents/skills/deliver/SKILL.md'])).toBe('low');
});

test('a workflow write grant, secret, environment or privileged trigger is a one-way door', async () => {
  const workflow = '.github/workflows/ci.yml';
  expect(await tierOf({ [workflow]: 'jobs:\n  a:\n    runs-on: x\n' })).toBe('medium');
  for (const line of [
    '      contents: write',
    '      id-token: write',
    'permissions: write-all',
    '    environment: release',
    '        token: secrets.T',
    `        token: \${{ secrets.X }}`,
    '  workflow_run:',
  ]) {
    expect(await tierOf({ [workflow]: `${line}\n` })).toBe('one-way-door');
  }
});

test('a workflow permissions block that names only read scopes is medium', async () => {
  const workflow = '.github/workflows/ci.yml';
  expect(await tierOf({ [workflow]: 'permissions:\n  contents: read\n' })).toBe('medium');
  expect(await tierOf({ [workflow]: 'permissions:\n  contents: none\n' })).toBe('medium');
});

test('the automerge section of clutch.yaml is a one-way door', async () => {
  expect(await tierOf({ 'clutch.yaml': 'capabilities:\n  ci: adopted\n' })).toBe('medium');
  expect(await tierOf({ 'clutch.yaml': 'automerge:\n  step: medium\n' })).toBe('one-way-door');
});

test('the text output names the files at the change tier and the pattern that set it', async () => {
  await using repo = await changeOf(['apps/web/src/app.ts', 'docs/a.md']);
  const result = await clutchRisk(repo.root, '--base', 'main');
  expect(result).toMatchObject({
    code: 0,
    stdout: 'risk/medium\n  apps/web/src/app.ts  (unmatched)\n',
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
