import { expect, test } from 'bun:test';
import { readFile } from 'node:fs/promises';
import path from 'node:path';

import { gitOrThrow } from '@/git';
import { gitRepo } from '@/testing/git-repo';
import { worktreeCommand } from '@/worktree-command';
import { gitBackend } from '@/worktree/git-backend';
import { newWorktree } from '@/worktree/new';
import type { NewWorktreeSteps } from '@/worktree/new';
import { defaultCheck, worktreeSettings } from '@/worktree/settings';

/** A project whose setup and check write to `order`, so a test sees what ran and when. */
const config = (check = 'echo check >> order') =>
  [
    'schemaVersion: 1',
    'project: shop',
    'template: { repo: eggdev/clutch, mode: sync }',
    'capabilities: {}',
    'worktree:',
    '  root: ../shop.worktrees',
    "  setup: ['echo project >> order']",
    `  check: '${check}'`,
    '',
  ].join('\n');

const runner = (workspace = 'worktree') =>
  [
    'description: A test machine.',
    'machine: box',
    't3_environment: local',
    `workspace: ${workspace}`,
    'setup:',
    '  - echo machine >> order',
    '',
  ].join('\n');

const project = (check?: string) => ({
  'clutch.yaml': config(check),
  'factory/runners/box.yaml': runner(),
  'factory/runners/mac.yaml': runner('main_checkout'),
  'factory/runners/broken.yaml': 'description: No machine.\nworkspace: worktree\n',
});

function steps(root: string) {
  const log: Array<string> = [];
  const value: NewWorktreeSteps = {
    backend: gitBackend(root),
    fetch: () => Promise.resolve({ ok: true, err: '' }),
    shell: (command, cwd) => Bun.spawn(['sh', '-c', command], { cwd }).exited,
    startIssue: () => Promise.resolve(0),
    devCheck: () => Promise.resolve(null),
    log: (line) => log.push(line),
  };
  return { value, log };
}

test('--runner runs the machine setup, then the project setup, then the check', async () => {
  await using repo = await gitRepo(project());
  const { value, log } = steps(repo.root);
  const made = await newWorktree(
    {
      repoRoot: repo.root,
      slug: 'smoke',
      base: 'main',
      settings: await worktreeSettings(repo.root),
      runner: 'box',
      check: true,
    },
    value,
  );
  expect(await readFile(path.join(made.path, 'order'), 'utf-8')).toBe('machine\nproject\ncheck\n');
  expect(made).toMatchObject({
    runner: 'box',
    check: { command: 'echo check >> order', exitCode: 0, passed: true },
  });
  expect(log).toContain('Runner box setup: echo machine >> order');
  expect(log).toContain('The check passed.');
});

test('the setup and the check come from the new checkout, not the working tree of the main one', async () => {
  await using repo = await gitRepo(project());
  await repo.write({ 'clutch.yaml': config('exit 9').replace('echo project', 'exit 8; echo') });
  const { value } = steps(repo.root);
  const made = await newWorktree(
    {
      repoRoot: repo.root,
      slug: 'fresh',
      base: 'main',
      settings: await worktreeSettings(repo.root),
      check: true,
    },
    value,
  );
  expect(made.check?.passed).toBe(true);
  expect(made.runner).toBeNull();
});

test('a failed check returns its exit code and keeps the checkout', async () => {
  await using repo = await gitRepo(project('exit 4'));
  const { value, log } = steps(repo.root);
  const made = await newWorktree(
    {
      repoRoot: repo.root,
      slug: 'red',
      base: 'main',
      settings: await worktreeSettings(repo.root),
      check: true,
    },
    value,
  );
  expect(made.check).toEqual({ command: 'exit 4', exitCode: 4, passed: false });
  expect(await Bun.file(path.join(made.path, 'order')).exists()).toBe(true);
  expect(log.at(-1)).toBe(
    `The check exited 4. The checkout stays at ${made.path}, so a person can look.`,
  );
});

test('without --check, nothing runs the check, and the default check is validate', async () => {
  await using repo = await gitRepo({
    ...project(),
    'clutch.yaml': config().replace(/ {2}check.*\n/u, ''),
  });
  const settings = await worktreeSettings(repo.root);
  expect(settings.check).toBe(defaultCheck);
  const { value } = steps(repo.root);
  const made = await newWorktree(
    { repoRoot: repo.root, slug: 'quiet', base: 'main', settings },
    value,
  );
  expect(made.check).toBeNull();
  expect(await readFile(path.join(made.path, 'order'), 'utf-8')).toBe('project\n');
});

test('a missing, broken or main-checkout runner removes the new checkout and its branch', async () => {
  await using repo = await gitRepo(project());
  const settings = await worktreeSettings(repo.root);
  const cases = [
    ['nope', 'No runner nope: factory/runners/nope.yaml does not exist'],
    ['broken', 'factory/runners/broken.yaml breaks the runner schema'],
    ['mac', 'The runner mac has workspace main_checkout'],
    ['Bad', 'must be lowercase kebab case'],
  ];
  for (const [name, reason] of cases) {
    const { value } = steps(repo.root);
    const slug = `lane-${name.toLowerCase()}`;
    await expect(
      newWorktree({ repoRoot: repo.root, slug, base: 'main', settings, runner: name }, value),
    ).rejects.toThrow(reason);
    expect(await Bun.file(path.join(settings.root, slug, '.git')).exists()).toBe(false);
    expect(await gitOrThrow(repo.root, 'branch', '--list', `clutch/${slug}`)).toBe('');
  }
});

test('new --json prints one line on stdout and exits with the check result', async () => {
  await using repo = await gitRepo(project('exit 5'));
  const output: Array<string> = [];
  const errors: Array<string> = [];
  const { log, error } = console;
  console.log = (line: string) => output.push(line);
  console.error = (line: string) => errors.push(line);
  let code: number;
  try {
    code = await worktreeCommand(
      ['new', 'lane', '--base', 'main', '--runner', 'box', '--check', '--json'],
      repo.root,
    );
  } finally {
    console.log = log;
    console.error = error;
  }
  expect(code).toBe(5);
  expect(output).toHaveLength(1);
  expect(JSON.parse(output[0])).toEqual({
    path: path.join(repo.parent, 'shop.worktrees/lane'),
    branch: 'clutch/lane',
    runner: 'box',
    check: { command: 'exit 5', exitCode: 5, passed: false },
  });
  expect(errors).toContain('Check: exit 5');
});
