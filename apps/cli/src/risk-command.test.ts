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

/** One run of `clutch risk` over a change: the tier of the change, and the tier of each file by its path. */
async function riskOf(files: Array<string> | Record<string, string>) {
  await using repo = await changeOf(files);
  const result = await clutchRisk(repo.root, '--base', 'main', '--json');
  expect(result.code).toBe(0);
  const report: { tier: string; files: Array<{ path: string; tier: string }> } = JSON.parse(
    result.stdout,
  );
  return {
    tier: report.tier,
    files: Object.fromEntries(report.files.map((file) => [file.path, file.tier])),
  };
}

/** Each path with one tier, as `riskOf` lists the files of a change. */
const eachAt = (paths: ReadonlyArray<string>, tier: string) =>
  Object.fromEntries(paths.map((file) => [file, tier]));

test('a docs-only change is low', async () => {
  const risk = await riskOf([
    'docs/contributing/review-notes.md',
    '.changeset/quiet-fox.md',
    'apps/cli/README.md',
  ]);
  expect(risk.tier).toBe('low');
});

test('tests alone are low, and app code is medium', async () => {
  const tests = await riskOf(['apps/cli/src/risk/tiers.test.ts']);
  expect(tests.tier).toBe('low');
  const code = await riskOf(['apps/cli/src/worktree/new.ts', 'docs/a.md']);
  expect(code.tier).toBe('medium');
});

// One run gives the tier of each path on its own, so a path that drops a tier shows by name.
test('the hard core is a one-way door: the merge gate, auth, migrations and policy docs', async () => {
  const hardCore = [
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
  ];
  const risk = await riskOf([...hardCore, 'docs/a.md']);
  expect(risk.files).toEqual({ ...eachAt(hardCore, 'one-way-door'), 'docs/a.md': 'low' });
  expect(risk.tier).toBe('one-way-door');
});

test('skills, check scripts, lint config, workflows and any unlisted path are medium or low', async () => {
  const medium = [
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
  ];
  const low = ['docs/a.md', 'AGENTS.md', '.agents/skills/deliver/SKILL.md'];
  const risk = await riskOf([...medium, ...low]);
  expect(risk.files).toEqual({ ...eachAt(medium, 'medium'), ...eachAt(low, 'low') });
  expect(risk.tier).toBe('medium');
});

test('a workflow permission or secret, or the automerge section, is a one-way door', async () => {
  const held = {
    '.github/workflows/permissions.yml': 'permissions:\n',
    '.github/workflows/contents.yml': '      contents: write\n',
    '.github/workflows/environment.yml': '    environment: release\n',
    '.github/workflows/secret.yml': '        token: secrets.T\n',
    '.github/workflows/workflow-run.yml': '  workflow_run:\n',
  };
  const risk = await riskOf({
    ...held,
    '.github/workflows/ci.yml': 'jobs:\n  a:\n    runs-on: x\n',
    'clutch.yaml': 'capabilities:\n  ci: adopted\n',
  });
  expect(risk.files).toEqual({
    ...eachAt(Object.keys(held), 'one-way-door'),
    '.github/workflows/ci.yml': 'medium',
    'clutch.yaml': 'medium',
  });
  const automerge = await riskOf({ 'clutch.yaml': 'automerge:\n  step: medium\n' });
  expect(automerge.files).toEqual({ 'clutch.yaml': 'one-way-door' });
  expect(automerge.tier).toBe('one-way-door');
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
