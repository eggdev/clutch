import { expect, test } from 'bun:test';
import path from 'node:path';

import { gitOrThrow } from '@/git';
import { gitRepo } from '@/testing/git-repo';
import { addTicket } from '@/tickets/change';
import { openStore, storeFile } from '@/tickets/store';

test('each worktree of a project opens one store file in the git common directory', async () => {
  await using repo = await gitRepo({});
  const other = path.join(repo.parent, 'other');
  await gitOrThrow(repo.root, 'worktree', 'add', '--quiet', '-b', 'other', other);
  expect(await storeFile(other)).toBe(path.join(repo.root, '.git', 'clutch', 'tickets.sqlite'));
  {
    using store = await openStore(repo.root);
    const ticket = { prefix: 'T', title: 'One', description: 'x', kind: null, hold: false };
    addTicket(store, 'owner', { ...ticket, source: null });
  }
  using store = await openStore(other);
  expect(store.ticket('T-1000').title).toBe('One');
  expect(await gitOrThrow(repo.root, 'status', '--porcelain')).toBe('');
});

test('two projects open two store files', async () => {
  await using shop = await gitRepo({});
  await using blog = await gitRepo({});
  expect(await storeFile(shop.root)).not.toBe(await storeFile(blog.root));
  await expect(storeFile(shop.parent)).rejects.toThrow('inside a git checkout');
});
