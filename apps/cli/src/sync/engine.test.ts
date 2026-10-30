import { expect, test } from 'bun:test';
import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import path from 'node:path';

import { gitOrThrow } from '@/git';
import { apply, plan } from '@/sync/engine';
import type { SyncFile, SyncSource } from '@/sync/engine';
import { gitRepo } from '@/testing/git-repo';

const file = (text: string): SyncFile => {
  const content = Buffer.from(text);
  const hash = createHash('sha256').update('100644').update('\0').update(content).digest('hex');
  return { mode: '100644', content, hash };
};

const record = '.sync/record.json';

function source(files: Record<string, string>, baseline: Record<string, string> = {}): SyncSource {
  return {
    files: new Map(Object.entries(files).map(([name, text]) => [name, file(text)])),
    baseline: new Map(Object.entries(baseline)),
    roots: ['tools/'],
  };
}

test('a missing file is added, a recorded file is updated, and a hand edit is a conflict', async () => {
  await using repo = await gitRepo({ 'tools/old.ts': 'v1', 'tools/edited.ts': 'mine' });
  const planned = await plan(
    repo.root,
    source({ 'tools/new.ts': 'new', 'tools/old.ts': 'v2', 'tools/edited.ts': 'theirs' }),
    { files: { 'tools/old.ts': file('v1').hash, 'tools/edited.ts': file('v0').hash } },
    record,
    null,
  );
  expect(planned.changes).toEqual([
    { path: 'tools/new.ts', action: 'add' },
    { path: 'tools/old.ts', action: 'update' },
  ]);
  expect(planned.conflicts).toEqual(['tools/edited.ts']);
});

test('a baseline hash counts as a known copy, and a file the source dropped is removed', async () => {
  await using repo = await gitRepo({ 'tools/legacy.ts': 'old copy', 'tools/gone.ts': 'gone' });
  const planned = await plan(
    repo.root,
    source({ 'tools/legacy.ts': 'current' }, { 'tools/legacy.ts': file('old copy').hash }),
    { files: { 'tools/gone.ts': file('gone').hash } },
    record,
    null,
  );
  expect(planned.changes).toEqual([
    { path: 'tools/legacy.ts', action: 'update' },
    { path: 'tools/gone.ts', action: 'remove' },
  ]);
  expect(planned.conflicts).toEqual([]);
});

test('apply writes the plan and removes the files the source dropped', async () => {
  await using repo = await gitRepo({ 'tools/gone/x.ts': 'gone', 'README.md': '#' });
  const next = source({ 'tools/new.ts': 'new' });
  const planned = await plan(
    repo.root,
    next,
    { files: { 'tools/gone/x.ts': file('gone').hash } },
    record,
    null,
  );
  await apply(repo.root, next, planned, record);
  expect(await readFile(path.join(repo.root, 'tools/new.ts'), 'utf-8')).toBe('new');
  expect(await gitOrThrow(repo.root, 'status', '--porcelain')).toBe(
    ' D tools/gone/x.ts\n?? tools/new.ts',
  );
});

test('apply refuses a managed path with uncommitted changes', async () => {
  // Git has v0, the working tree has v1, and the record says v1: the plan updates it, but git sees it dirty.
  await using repo = await gitRepo({ 'tools/old.ts': 'v0' });
  await repo.write({ 'tools/old.ts': 'v1' });
  const next = source({ 'tools/old.ts': 'v2' });
  const planned = await plan(
    repo.root,
    next,
    { files: { 'tools/old.ts': file('v1').hash } },
    record,
    null,
  );
  expect(planned.changes).toEqual([{ path: 'tools/old.ts', action: 'update' }]);
  await expect(apply(repo.root, next, planned, record)).rejects.toThrow('Commit or stash');
});
