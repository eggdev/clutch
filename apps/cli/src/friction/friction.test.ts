import { expect, test } from 'bun:test';
import { readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';

import { frictionCommand } from '@/friction-command';
import { readEntries, since } from '@/friction/log';
import { gitRepo } from '@/testing/git-repo';

/** Runs `clutch friction` with output captured. */
async function friction(args: Array<string>, cwd: string, now = new Date('2026-11-02T10:00:00Z')) {
  const out: Array<string> = [];
  const err: Array<string> = [];
  const { log, error } = console;
  console.log = (line: string) => out.push(line);
  console.error = (line: string) => err.push(line);
  try {
    return { code: await frictionCommand(args, cwd, now), out, err };
  } finally {
    console.log = log;
    console.error = error;
  }
}

test('add appends one valid JSON line with the time, issue, kind, text and branch', async () => {
  await using repo = await gitRepo({ 'package.json': '{}' });
  const file = path.join(repo.parent, 'friction.jsonl');
  // A file without a final newline still gets a line of its own.
  await writeFile(
    file,
    JSON.stringify({
      at: '2026-10-29T09:00:00.000Z',
      issue: null,
      kind: 'docs',
      text: 'old',
      branch: null,
    }),
  );
  const added = await friction(
    [
      'add',
      'pr open could not push a rebased branch',
      '--issue',
      'CL-024',
      '--kind',
      'tooling',
      '--file',
      file,
    ],
    repo.root,
  );
  expect(added.code).toBe(0);
  expect(added.out).toEqual([
    `Added to ../friction.jsonl: tooling: pr open could not push a rebased branch`,
  ]);
  const text = await readFile(file, 'utf-8');
  const lines = text.split('\n');
  expect(lines).toHaveLength(3);
  expect(lines[2]).toBe('');
  expect(JSON.parse(lines[1])).toEqual({
    at: '2026-11-02T10:00:00.000Z',
    issue: 'CL-024',
    kind: 'tooling',
    text: 'pr open could not push a rebased branch',
    branch: 'main',
  });
  const entries = await readEntries(file);
  expect(entries.map((entry) => entry.text)).toEqual([
    'old',
    'pr open could not push a rebased branch',
  ]);
});

test('a bad kind, a bad issue or empty text is refused with the fix, and writes nothing', async () => {
  await using repo = await gitRepo({ 'package.json': '{}' });
  const file = path.join(repo.parent, 'friction.jsonl');
  const kind = await friction(['add', 'x', '--kind', 'mood', '--file', file], repo.root);
  const issue = await friction(['add', 'x', '--issue', 'cl-1', '--file', file], repo.root);
  const empty = await friction(['add', '--file', file], repo.root);
  expect([kind.code, issue.code, empty.code]).toEqual([1, 1, 1]);
  expect(kind.err[0]).toBe('--kind is one of tooling, docs, check, flake, not mood.');
  expect(issue.err[0]).toBe('--issue takes an id such as CL-306, not cl-1.');
  expect(empty.err[0]).toContain('clutch friction add "<what slowed you down>"');
  expect(await Bun.file(file).exists()).toBe(false);
});

test('list --since keeps the recent entries, and --json prints them as data', async () => {
  await using repo = await gitRepo({ 'package.json': '{}' });
  const file = path.join(repo.parent, 'friction.jsonl');
  const now = new Date('2026-11-02T10:00:00Z');
  await friction(
    ['add', 'ten days ago', '--file', file],
    repo.root,
    new Date('2026-10-23T10:00:00Z'),
  );
  await friction(
    ['add', 'two days ago', '--kind', 'check', '--file', file],
    repo.root,
    new Date('2026-10-31T10:00:00Z'),
  );
  const recent = await friction(
    ['list', '--since', '7d', '--json', '--file', file],
    repo.root,
    now,
  );
  expect(JSON.parse(recent.out[0]).map((entry: { text: string }) => entry.text)).toEqual([
    'two days ago',
  ]);
  const all = await friction(['list', '--file', file], repo.root, now);
  expect(all.out).toHaveLength(2);
  expect(all.out[1]).toBe('2026-10-31T10:00:00.000Z  check  -  two days ago');
  expect(since(await readEntries(file), '12h', now)).toEqual([]);
  const bad = await friction(['list', '--since', 'a week', '--file', file], repo.root, now);
  expect(bad.err[0]).toBe('--since takes a span such as 7d or 12h, not a week.');
});

test('a broken line fails list with its line number, and an empty log lists nothing', async () => {
  await using repo = await gitRepo({ 'package.json': '{}' });
  const file = path.join(repo.parent, 'friction.jsonl');
  const empty = await friction(['list', '--file', file], repo.root);
  expect(empty.out).toEqual(['No friction entries.']);
  await writeFile(
    file,
    '{"at":"2026-11-01T00:00:00Z","issue":null,"kind":"docs","text":"ok","branch":null}\nnot json\n',
  );
  const broken = await friction(['list', '--file', file], repo.root);
  expect(broken.code).toBe(1);
  expect(broken.err[0]).toContain('friction.jsonl:2 is not a friction entry');
});

test('the repository log is valid JSONL', async () => {
  const entries = await readEntries(
    path.resolve(import.meta.dir, '../../../../.clutch/friction.jsonl'),
  );
  expect(entries.every((entry) => entry.text.length > 0)).toBe(true);
});
