import { afterAll, beforeAll, expect, test } from 'bun:test';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { fake } from '@tools/github/fake-run';
import { ask, missingSections } from '@tools/github/needs-owner';

const form = [
  '## Goal',
  'Sign-up takes a fourth click.',
  '## Options',
  'A or B.',
  '## What each option changes for users',
  'A adds a screen.',
  '## My pick',
  'B.',
].join('\n');

let dir: string;
let file: string;

beforeAll(async () => {
  dir = await mkdtemp(path.join(tmpdir(), 'needs-owner-'));
  file = path.join(dir, 'question.md');
  await writeFile(file, form);
});

afterAll(() => rm(dir, { recursive: true, force: true }));

test('a question opens one needs-owner issue, assigned to the owner', async () => {
  const gh = fake([
    ['gh issue list', { out: '[]' }],
    ['gh issue create', { out: 'https://github.com/o/r/issues/9\n' }],
  ]);
  expect(await ask(gh.run, 'Does sign-up get a fourth click?', file)).toBe(0);
  const create = gh.calls.find((call) => call.startsWith('gh issue create'));
  expect(create).toContain('--label needs-owner');
  expect(create).toContain('--assignee ');
});

test('a question that is already open opens no second issue', async () => {
  const title = 'Does sign-up get a fourth click?';
  const gh = fake([
    ['gh issue list', { out: JSON.stringify([{ title, url: 'https://github.com/o/r/issues/9' }]) }],
  ]);
  expect(await ask(gh.run, title, file)).toBe(0);
  expect(gh.calls.some((call) => call.startsWith('gh issue create'))).toBe(false);
});

test('a question outside the fixed form is refused and names what it lacks', async () => {
  const thin = path.join(dir, 'thin.md');
  await writeFile(thin, '## Goal\nShip it?\n');
  const gh = fake([]);
  await expect(ask(gh.run, 'Ship it?', thin)).rejects.toThrow(
    'The question lacks ## Options, ## What each option changes for users, ## My pick. Each section is a heading with text under it.',
  );
  expect(gh.calls).toEqual([]);
  expect(missingSections(form)).toEqual([]);
  expect(missingSections(form.replace('A or B.', ''))).toEqual(['## Options']);
});
