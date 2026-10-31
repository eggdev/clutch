import { expect, test } from 'bun:test';
import { readFile } from 'node:fs/promises';
import path from 'node:path';

import { gitOrThrow } from '@/git';
import { syncCommand } from '@/sync-command';
import { runSync } from '@/sync/run';
import { lineagePath } from '@/sync/source';
import { gitRepo } from '@/testing/git-repo';

const list = 'version: 1\nfiles:\n  - path: tools/\n    rule: managed\n';

async function commit(root: string, message: string) {
  await gitOrThrow(root, 'add', '--all');
  await gitOrThrow(root, 'commit', '--quiet', '--message', message);
  return gitOrThrow(root, 'rev-parse', 'HEAD');
}

/** A Clutch checkout at v1 and a project synced to it, whose knip.jsonc the project then edited. */
async function edited() {
  const template = await gitRepo({ 'clutch.files.yaml': list, 'tools/knip.jsonc': 'v1\n' });
  const first = await gitOrThrow(template.root, 'rev-parse', 'HEAD');
  await template.write({ 'tools/knip.jsonc': 'v2\n' });
  const second = await commit(template.root, 'v2');
  const target = await gitRepo({ 'README.md': '#\n' });
  await runSync({ root: target.root, template: template.root, to: first });
  await target.write({ 'tools/knip.jsonc': 'ours\n' });
  await commit(target.root, 'Customize knip');
  return { template, target, second };
}

const read = (root: string, file: string) => readFile(path.join(root, file), 'utf-8');

test('a kept file is not asked again until Clutch changes it again', async () => {
  const { template, target, second } = await edited();
  await using _template = template;
  await using _target = target;
  const pending = await runSync({ root: target.root, template: template.root, to: second });
  expect([pending.status, pending.decisions]).toEqual(['decisions', ['tools/knip.jsonc']]);

  const kept = await runSync({
    root: target.root,
    template: template.root,
    to: second,
    keep: ['tools/knip.jsonc'],
  });
  expect(kept.status).toBe('synced');
  expect(await read(target.root, 'tools/knip.jsonc')).toBe('ours\n');
  expect(JSON.parse(await read(target.root, lineagePath)).kept).toEqual({
    'tools/knip.jsonc': expect.stringMatching(/^[0-9a-f]{64}$/u),
  });
  await commit(target.root, 'Sync');
  expect(
    await runSync({ root: target.root, template: template.root, to: second, check: true }),
  ).toMatchObject({
    status: 'unchanged',
    decisions: [],
  });

  await template.write({ 'tools/knip.jsonc': 'v3\n' });
  const third = await commit(template.root, 'v3');
  const again = await runSync({
    root: target.root,
    template: template.root,
    to: third,
    check: true,
  });
  expect([again.status, again.decisions]).toEqual(['decisions', ['tools/knip.jsonc']]);
});

test('take replaces the file with Clutch copy and records no kept entry', async () => {
  const { template, target, second } = await edited();
  await using _template = template;
  await using _target = target;
  const taken = await runSync({
    root: target.root,
    template: template.root,
    to: second,
    take: ['tools/knip.jsonc'],
  });
  expect(taken.status).toBe('synced');
  expect(taken.changes).toContainEqual({ path: 'tools/knip.jsonc', action: 'update' });
  expect(await read(target.root, 'tools/knip.jsonc')).toBe('v2\n');
  expect(JSON.parse(await read(target.root, lineagePath)).kept).toBeUndefined();
});

test('a keep or take for a file that needs no decision is refused', async () => {
  const { template, target, second } = await edited();
  await using _template = template;
  await using _target = target;
  await expect(
    runSync({ root: target.root, template: template.root, to: second, keep: ['tools/other.ts'] }),
  ).rejects.toThrow('tools/other.ts needs no decision.');
});

test('without a terminal, sync lists the decisions and exits 2 without waiting', async () => {
  const { template, target, second } = await edited();
  await using _template = template;
  await using _target = target;
  const output: Array<string> = [];
  const { log } = console;
  const tty = { stdin: process.stdin.isTTY, stdout: process.stdout.isTTY };
  console.log = (line: string) => output.push(line);
  // No terminal, even when a person runs the tests in one.
  process.stdin.isTTY = false;
  process.stdout.isTTY = false;
  try {
    expect(
      await syncCommand(['--root', target.root, '--to', second], target.root, template.root),
    ).toBe(2);
  } finally {
    console.log = log;
    process.stdin.isTTY = tty.stdin;
    process.stdout.isTTY = tty.stdout;
  }
  expect(output.join('\n')).toContain('Then run sync again with --keep <file> or --take <file>');
  expect(await read(target.root, 'tools/knip.jsonc')).toBe('ours\n');
});
