import { expect, test } from 'bun:test';
import { readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';

import { gitOrThrow } from '@/git';
import { gitRepo } from '@/testing/git-repo';
import { worktreeCommand } from '@/worktree-command';
import type { WorktreeBackend, WorktreeRecord } from '@/worktree/backend';
import { gitBackend, parsePorcelain } from '@/worktree/git-backend';
import { formatWorktrees, listWorktrees } from '@/worktree/list';
import { branchName, issueOf } from '@/worktree/names';
import { newWorktree } from '@/worktree/new';
import type { NewWorktreeSteps } from '@/worktree/new';
import { defaultSetup, worktreeSettings } from '@/worktree/settings';

const config = [
  'schemaVersion: 1',
  'project: shop',
  'template: { repo: eggdev/clutch, mode: sync }',
  'capabilities: {}',
  'worktree:',
  '  root: ../shop.worktrees',
  '  copy: [.env.local, missing.env]',
  "  setup: ['touch setup-ran']",
  '',
].join('\n');

/** The steps of `new`, with git and the shell real, and the rest recorded. */
function steps(backend: WorktreeBackend) {
  const log: Array<string> = [];
  const started: Array<[string, string]> = [];
  const value: NewWorktreeSteps = {
    backend,
    fetch: () => Promise.resolve({ ok: true, err: '' }),
    shell: (command, cwd) => Bun.spawn(['sh', '-c', command], { cwd }).exited,
    startIssue: (issue, cwd) => {
      started.push([issue, cwd]);
      return Promise.resolve(0);
    },
    devCheck: () => Promise.resolve(null),
    log: (line) => log.push(line),
  };
  return { value, log, started };
}

test('new makes a branch from the base in its own folder, copies the files and runs the setup', async () => {
  await using repo = await gitRepo({ 'clutch.yaml': config, 'README.md': '# Shop\n' });
  await writeFile(path.join(repo.root, '.env.local'), 'SECRET=1\n');
  const settings = await worktreeSettings(repo.root);
  expect(settings.root).toBe(path.join(repo.parent, 'shop.worktrees'));
  const { value, log, started } = steps(gitBackend(repo.root));
  const made = await newWorktree(
    { repoRoot: repo.root, slug: 'cart-total', base: 'main', settings },
    value,
  );
  const target = path.join(repo.parent, 'shop.worktrees/cart-total');
  expect(made).toMatchObject({ path: target, branch: 'clutch/cart-total', copied: ['.env.local'] });
  expect(await gitOrThrow(target, 'branch', '--show-current')).toBe('clutch/cart-total');
  expect(await readFile(path.join(target, '.env.local'), 'utf-8')).toBe('SECRET=1\n');
  expect(await Bun.file(path.join(target, 'setup-ran')).exists()).toBe(true);
  expect(log).toContain(`Path: ${target}`);
  expect(log).toContain('Branch: clutch/cart-total (from main)');
  expect(started).toEqual([]);
  await expect(
    newWorktree({ repoRoot: repo.root, slug: 'cart-total', base: 'main', settings }, value),
  ).rejects.toThrow('already holds a checkout');
});

test('--issue names the branch after the issue and starts the issue in the new checkout', async () => {
  await using repo = await gitRepo({ 'clutch.yaml': config });
  const { value, started } = steps(gitBackend(repo.root));
  const made = await newWorktree(
    {
      repoRoot: repo.root,
      slug: 'worktree',
      issue: 'CL-201',
      base: 'main',
      settings: await worktreeSettings(repo.root),
    },
    value,
  );
  expect(made.branch).toBe('clutch/cl-201-worktree');
  expect(started).toEqual([['CL-201', made.path]]);
});

test('a failed setup command stops with the checkout path', async () => {
  await using repo = await gitRepo({ 'clutch.yaml': config.replace('touch setup-ran', 'exit 3') });
  const { value } = steps(gitBackend(repo.root));
  await expect(
    newWorktree(
      {
        repoRoot: repo.root,
        slug: 'broken',
        base: 'main',
        settings: await worktreeSettings(repo.root),
      },
      value,
    ),
  ).rejects.toThrow('Setup command "exit 3" exited 3');
});

test('without a worktree block, checkouts go beside the repository and the setup installs dependencies', async () => {
  await using repo = await gitRepo({ 'package.json': '{}' }, { name: 'shop' });
  expect(await worktreeSettings(repo.root)).toEqual({
    root: path.join(repo.parent, 'shop.worktrees'),
    copy: [],
    setup: defaultSetup,
  });
});

test('list shows each checkout with its branch, dirty state, issue and PR', async () => {
  await using repo = await gitRepo({ 'clutch.yaml': config });
  const settings = await worktreeSettings(repo.root);
  const { value } = steps(gitBackend(repo.root));
  const a = await newWorktree(
    { repoRoot: repo.root, slug: 'a', issue: 'CL-201', base: 'main', settings },
    value,
  );
  await newWorktree({ repoRoot: repo.root, slug: 'b', base: 'main', settings }, value);
  // The setup file is untracked, so both are dirty. Commit it in one of them.
  await gitOrThrow(a.path, 'add', '--all');
  await gitOrThrow(a.path, 'commit', '--quiet', '--message', 'Setup');
  const listed = await listWorktrees(gitBackend(repo.root), (branch) =>
    Promise.resolve(
      branch === 'clutch/cl-201-a'
        ? { number: 7, url: 'https://example.test/7', state: 'OPEN' }
        : null,
    ),
  );
  expect(
    listed.map(({ branch, dirty, main, issue, pr }) => ({
      branch,
      dirty,
      main,
      issue,
      pr: pr?.number ?? null,
    })),
  ).toEqual([
    { branch: 'main', dirty: false, main: true, issue: null, pr: null },
    { branch: 'clutch/cl-201-a', dirty: false, main: false, issue: 'CL-201', pr: 7 },
    { branch: 'clutch/b', dirty: true, main: false, issue: null, pr: null },
  ]);
  expect(formatWorktrees(listed).split('\n')[1]).toContain(
    'clutch/cl-201-a  clean  CL-201  PR #7 open',
  );
});

test('the commands work on any backend, so they do not call git themselves', async () => {
  const records: Array<WorktreeRecord> = [
    { path: '/repo', branch: 'main', head: 'a'.repeat(40), dirty: false },
  ];
  const calls: Array<string> = [];
  const fake: WorktreeBackend = {
    create: ({ branch, path: where }) => {
      calls.push(`create ${branch} ${where}`);
      const record = { path: where, branch, head: 'b'.repeat(40), dirty: false };
      records.push(record);
      return Promise.resolve(record);
    },
    list: () => Promise.resolve(records),
    remove: () => Promise.resolve(),
  };
  await using folder = await gitRepo({}, { git: false });
  const { value } = steps(fake);
  await newWorktree(
    {
      repoRoot: folder.root,
      slug: 'fake',
      issue: 'CL-300',
      base: 'origin/main',
      settings: { root: path.join(folder.parent, 'wt'), copy: [], setup: [] },
    },
    value,
  );
  expect(calls).toEqual([`create clutch/cl-300-fake ${path.join(folder.parent, 'wt/fake')}`]);
  const listed = await listWorktrees(fake, () => Promise.resolve(null));
  expect(listed.map((item) => item.issue)).toEqual([null, 'CL-300']);
});

test('names, issue links and the porcelain format', () => {
  expect(branchName('cart')).toBe('clutch/cart');
  expect(branchName('cart', 'CL-201b')).toBe('clutch/cl-201b-cart');
  expect(() => branchName('cart', 'cl-1')).toThrow('--issue takes an id such as CL-201');
  expect(issueOf('clutch/cl-201b-cart')).toBe('CL-201b');
  expect(issueOf('feature/x')).toBeNull();
  expect(
    parsePorcelain(
      'worktree /r\nHEAD abc\nbranch refs/heads/main\n\nworktree /r2\nHEAD def\ndetached\n\nworktree /bare\nbare\n',
    ),
  ).toEqual([
    { path: '/r', head: 'abc', branch: 'main', bare: false },
    { path: '/r2', head: 'def', branch: null, bare: false },
  ]);
});

test('worktree list --json prints the checkouts, and a bad slug or action exits 1 with the fix', async () => {
  await using repo = await gitRepo({ 'clutch.yaml': config });
  const output: Array<string> = [];
  const errors: Array<string> = [];
  const { log, error } = console;
  console.log = (line: string) => output.push(line);
  console.error = (line: string) => errors.push(line);
  try {
    expect(await worktreeCommand(['list', '--json'], repo.root)).toBe(0);
    expect(await worktreeCommand(['new', 'Bad Slug', '--base', 'main'], repo.root)).toBe(1);
    expect(await worktreeCommand(['prune'], repo.root)).toBe(1);
  } finally {
    console.log = log;
    console.error = error;
  }
  expect(JSON.parse(output[0])).toEqual([
    expect.objectContaining({ path: repo.root, branch: 'main', main: true }),
  ]);
  expect(errors[0]).toContain('Give a slug of lower case letters');
  expect(errors[1]).toContain('clutch worktree new <slug>');
});
