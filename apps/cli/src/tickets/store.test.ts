import { Database } from 'bun:sqlite';
import { expect, test } from 'bun:test';
import { mkdir } from 'node:fs/promises';
import path from 'node:path';

import { gitOrThrow } from '@/git';
import { gitRepo } from '@/testing/git-repo';
import { addTicket } from '@/tickets/change';
import { TicketStore, openStore, storeFile } from '@/tickets/store';

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

test('a store of version 1 opens, and its tickets have no hold reason', async () => {
  await using repo = await gitRepo({});
  const file = await storeFile(repo.root);
  await mkdir(path.dirname(file), { recursive: true });
  {
    using store = new TicketStore(file);
    addTicket(store, 'owner', {
      prefix: 'T',
      title: 'One',
      description: 'x',
      kind: null,
      hold: true,
      source: null,
    });
    store.db.exec('ALTER TABLE tickets DROP COLUMN hold_reason; PRAGMA user_version=1;');
  }
  {
    using old = new Database(file);
    expect(old.query('PRAGMA user_version').get()).toEqual({ user_version: 1 });
  }
  using store = new TicketStore(file);
  expect(store.ticket('T-1000')).toMatchObject({ hold: true, holdReason: null });
});
