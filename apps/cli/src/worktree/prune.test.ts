import { expect, test } from 'bun:test';
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';

import { gitOrThrow } from '@/git';
import { gitRepo } from '@/testing/git-repo';
import { gitBackend } from '@/worktree/git-backend';
import type { ListedWorktree } from '@/worktree/list';
import { pruneWorktrees } from '@/worktree/prune';

type Pr = NonNullable<ListedWorktree['pr']>;

/**
 * A repository with a checkout per branch in `wt/<name>`. `commit` adds one
 * commit there, and `push` copies the branch to `origin` as a remote ref, so
 * the commits count as held by a remote without a real remote.
 */
async function fixture() {
  const repo = await gitRepo({ 'README.md': '# Shop\n' });
  const backend = gitBackend(repo.root);
  const prs = new Map<string, Pr>();
  const at = (name: string) => path.join(repo.parent, 'wt', name);
  const add = async (name: string) => {
    await gitOrThrow(repo.root, 'worktree', 'add', '--quiet', '-b', name, at(name), 'main');
    return at(name);
  };
  const commit = async (name: string, file = `${name}.txt`) => {
    await writeFile(path.join(at(name), file), `${file}\n`);
    await gitOrThrow(at(name), 'add', '--all');
    await gitOrThrow(at(name), 'commit', '--quiet', '--message', file);
    return gitOrThrow(at(name), 'rev-parse', 'HEAD');
  };
  const push = (name: string) =>
    gitOrThrow(repo.root, 'update-ref', `refs/remotes/origin/${name}`, name);
  const pr = (name: string, state: string, head: string) =>
    prs.set(name, { number: prs.size + 1, url: 'https://example.test', state, head });
  /** A finished task: one commit, pushed, with a PR in `state` at that commit. */
  const finished = async (name: string, state: string) => {
    await add(name);
    const head = await commit(name);
    await push(name);
    pr(name, state, head);
  };
  const log: Array<string> = [];
  const stopped: Array<string> = [];
  const prune = (options: { dryRun?: boolean; cwd?: string } = {}) =>
    pruneWorktrees(
      { base: 'main', cwd: options.cwd ?? repo.root, dryRun: options.dryRun ?? false },
      {
        backend,
        findPr: (branch) => Promise.resolve(prs.get(branch) ?? null),
        stopServers: (cwd) => {
          stopped.push(cwd);
          return Promise.resolve(false);
        },
        log: (line) => log.push(line),
      },
    );
  const branches = async () => {
    const out = await gitOrThrow(repo.root, 'branch', '--format=%(refname:short)');
    return out.split('\n').toSorted();
  };
  const paths = async () => {
    const records = await backend.list();
    return records.map((record) => record.path);
  };
  return { repo, at, add, commit, push, pr, finished, prune, log, stopped, branches, paths };
}

test('prune removes a squash-merged checkout and its branch, and a closed one but not its branch', async () => {
  const f = await fixture();
  await using _repo = f.repo;
  await f.finished('merged', 'MERGED');
  await f.finished('closed', 'CLOSED');
  // A squash merge leaves the branch's commits off main.
  await f.repo.write({ 'squash.txt': 'squash\n' });
  await gitOrThrow(f.repo.root, 'add', '--all');
  await gitOrThrow(f.repo.root, 'commit', '--quiet', '--message', 'Squash merge');
  const results = await f.prune();
  // git lists the checkouts by name.
  expect(results.map(({ branch, action }) => [branch, action])).toEqual([
    ['closed', 'removed'],
    ['merged', 'removed'],
  ]);
  expect(await f.paths()).toEqual([f.repo.root]);
  expect(await f.branches()).toEqual(['closed', 'main']);
  expect(f.stopped).toEqual([f.at('closed'), f.at('merged')]);
  expect(f.log).toEqual([
    `Removed ${f.at('closed')}: PR #2 is closed, kept closed.`,
    `Removed ${f.at('merged')}: PR #1 is merged.`,
  ]);
});

test('prune removes a checkout at its merged PR head after GitHub deleted the branch', async () => {
  const f = await fixture();
  await using _repo = f.repo;
  await f.add('gone');
  // Never pushed here: the remote branch is gone, and only the PR's head ref holds the commit.
  f.pr('gone', 'MERGED', await f.commit('gone'));
  const results = await f.prune();
  expect(results.map(({ action }) => action)).toEqual(['removed']);
  expect(await f.branches()).toEqual(['main']);
});

test('prune keeps a checkout without a PR, with an open PR, or detached', async () => {
  const f = await fixture();
  await using _repo = f.repo;
  // A new branch has no commits of its own, so it is merged into main. That alone never prunes it.
  await f.add('fresh');
  await f.finished('open', 'OPEN');
  const detached = path.join(f.repo.parent, 'wt', 'detached');
  await gitOrThrow(f.repo.root, 'worktree', 'add', '--quiet', '--detach', detached, 'main');
  const results = await f.prune();
  expect(results.map(({ action, reason }) => [action, reason])).toEqual([
    ['kept', 'its HEAD is detached, so no PR finishes it'],
    ['kept', 'its branch has no PR'],
    ['kept', 'PR #1 is open'],
  ]);
  expect(await f.paths()).toHaveLength(4);
  expect(f.stopped).toEqual([]);
});

test('prune keeps a finished checkout that would lose work, or that the command runs in', async () => {
  const f = await fixture();
  await using _repo = f.repo;
  await f.finished('dirty', 'MERGED');
  await writeFile(path.join(f.at('dirty'), 'scratch.txt'), 'scratch\n');
  await f.finished('unpushed', 'MERGED');
  await f.commit('unpushed', 'more.txt');
  await f.finished('after', 'MERGED');
  await f.commit('after', 'next.txt');
  await f.push('after');
  await f.finished('here', 'MERGED');
  const inside = path.join(f.at('here'), 'apps');
  await mkdir(inside);
  const results = await f.prune({ cwd: inside });
  expect(results.map(({ branch, reason }) => [branch, reason])).toEqual([
    ['after', 'it has commits after PR #3'],
    ['dirty', 'it has uncommitted changes'],
    ['here', 'this command runs inside it'],
    ['unpushed', 'it has 1 commit(s) that no remote holds'],
  ]);
  expect(await f.paths()).toHaveLength(5);
  expect(await f.branches()).toEqual(['after', 'dirty', 'here', 'main', 'unpushed']);
});

test('prune --dry-run names what it would remove and removes nothing', async () => {
  const f = await fixture();
  await using _repo = f.repo;
  await f.finished('merged', 'MERGED');
  const results = await f.prune({ dryRun: true });
  expect(results).toEqual([
    { path: f.at('merged'), branch: 'merged', action: 'removed', reason: 'PR #1 is merged' },
  ]);
  expect(f.log).toEqual([`Would remove ${f.at('merged')}: PR #1 is merged.`]);
  expect(await f.paths()).toHaveLength(2);
  expect(f.stopped).toEqual([]);
});

test('prune reports a removal that fails and goes on to the next checkout', async () => {
  const f = await fixture();
  await using _repo = f.repo;
  await f.finished('locked', 'MERGED');
  await f.finished('merged', 'MERGED');
  await gitOrThrow(f.repo.root, 'worktree', 'lock', f.at('locked'));
  const results = await f.prune();
  expect(results.map(({ branch, action }) => [branch, action])).toEqual([
    ['locked', 'failed'],
    ['merged', 'removed'],
  ]);
  expect(f.log[0]).toStartWith(`Failed to remove ${f.at('locked')}: git worktree remove`);
  expect(await f.branches()).toEqual(['locked', 'main']);
});
