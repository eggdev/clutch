import { expect, test } from 'bun:test';
import { existsSync } from 'node:fs';
import { rm, writeFile } from 'node:fs/promises';
import path from 'node:path';

import { gitOrThrow } from '@/git';
import { main, phaseFile, project, routed } from '@/testing/ticket-project';

test('deploy done exits 1 while a linked pull request is open, and the worktree goes after the merge', async () => {
  const merged = `${process.execPath} ${main} tickets merged "$CLUTCH_TICKET"`;
  const phases = [
    '  - { id: build, thread: work, prompt: Build., check: "true" }',
    `  - { id: deploy, thread: work, prompt: Deploy., check: '${merged}' }`,
    '',
  ].join('\n');
  await using shop = await project(phaseFile('{ threads: 6, device: 2 }', phases));
  // T3 Code makes the worktree of a thread under ~/.t3/worktrees.
  const worktree = path.join(shop.home, '.t3', 'worktrees', 'shop', 'sh-1000');
  const branch = 'clutch/sh-1000-fix';
  await gitOrThrow(shop.root, 'worktree', 'add', '--quiet', '-b', branch, worktree, 'main');
  const env = { FAKE_WORKTREE: worktree };
  const { id } = await routed(shop, 'Fix', 'build,deploy', env);
  await shop.tickets(['phase', id, 'build', 'done'], env);

  expect(await shop.tickets(['merged', id])).toMatchObject({
    code: 1,
    json: { message: 'SH-1000 has no pull_request link.' },
  });
  await shop.tickets(['link', id, '--kind', 'pull_request', 'https://github.com/o/r/pull/7']);
  const open = await shop.tickets(['phase', id, 'deploy', 'done'], env, worktree);
  expect(open.code).toBe(1);
  expect(open.json.message).toContain('https://github.com/o/r/pull/7 is OPEN');

  await writeFile(path.join(worktree, 'fix.txt'), 'fixed\n');
  await gitOrThrow(worktree, 'add', '--all');
  await gitOrThrow(worktree, 'commit', '--quiet', '--message', 'Fix');
  await gitOrThrow(shop.root, 'merge', '--quiet', '--no-ff', '--no-edit', branch);
  const mergedEnv = { ...env, FAKE_GH_STATE: 'MERGED' };
  // The agent ends the phase from inside the worktree, so that dispatch keeps it.
  const done = await shop.tickets(['phase', id, 'deploy', 'done'], mergedEnv, worktree);
  expect(done.code).toBe(0);
  expect(done.json.ticket.phases.map((row) => row.status)).toEqual(['done', 'done', 'done']);
  expect(done.json.dispatch).toMatchObject([{ kind: 'keep' }]);

  await writeFile(path.join(worktree, 'notes.txt'), 'draft\n');
  const dirty = await shop.tickets(['dispatch']);
  expect(dirty.json.dispatch).toMatchObject([
    { kind: 'keep', reason: `${worktree} stays: it has uncommitted changes.` },
  ]);
  await rm(path.join(worktree, 'notes.txt'));
  const removed = await shop.tickets(['dispatch']);
  expect(removed.json.dispatch).toMatchObject([
    { kind: 'remove', reason: `Removed ${worktree}, and deleted ${branch}.` },
  ]);
  expect(existsSync(worktree)).toBe(false);
  expect(await gitOrThrow(shop.root, 'branch', '--list', branch)).toBe('');
  const again = await shop.tickets(['dispatch']);
  expect(again.json.dispatch).toEqual([]);
  const log = await shop.log();
  expect(log.filter((line) => line.kind === 'remove')).toHaveLength(1);
});
