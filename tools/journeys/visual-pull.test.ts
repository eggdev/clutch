import { expect, test } from 'bun:test';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { comparing, shotName } from '@repo/journeys/testing/visual';
import type { Run } from '@tools/github/stack';
import { copyShots, isBaseline, pull } from '@tools/journeys/visual-pull';

function folder() {
  return mkdtemp(path.join(tmpdir(), 'visual-'));
}

async function put(root: string, file: string, body: string) {
  await mkdir(path.dirname(path.join(root, file)), { recursive: true });
  await writeFile(path.join(root, file), body);
}

const baseline = 'features/notes/journeys/__screenshots__/home-mobile-light.png';

test('a shot is named by its snap, width and scheme', () => {
  expect(shotName('notes-open', 'desktop', 'dark')).toBe('notes-open-desktop-dark.png');
});

test('only CI or VISUAL_COMPARE=1 compares with the baselines', () => {
  expect(comparing({})).toBe(false);
  expect(comparing({ CI: '0' })).toBe(false);
  expect(comparing({ CI: 'true' })).toBe(true);
  expect(comparing({ VISUAL_COMPARE: '1' })).toBe(true);
});

test('a baseline is a PNG in a __screenshots__ folder inside the repository', () => {
  expect(isBaseline(baseline)).toBe(true);
  expect(isBaseline('features/notes/journeys/home.png')).toBe(false);
  expect(isBaseline('features/notes/journeys/__screenshots__/notes.txt')).toBe(false);
  expect(isBaseline('../outside/__screenshots__/home.png')).toBe(false);
});

test('copyShots adds new baselines, changes different ones and leaves equal ones', async () => {
  const [from, root] = [await folder(), await folder()];
  try {
    const same = 'features/notes/journeys/__screenshots__/home-mobile-dark.png';
    const added = 'features/notes/journeys/__screenshots__/notes-open-mobile-light.png';
    await put(from, baseline, 'new pixels');
    await put(from, same, 'same pixels');
    await put(from, added, 'first pixels');
    await put(from, 'stray.txt', 'not a baseline');
    await put(root, baseline, 'old pixels');
    await put(root, same, 'same pixels');
    expect(await copyShots(from, root)).toEqual({ added: [added], changed: [baseline] });
    expect(await readFile(path.join(root, baseline), 'utf-8')).toBe('new pixels');
    expect(await readFile(path.join(root, 'stray.txt')).catch(() => null)).toBeNull();
  } finally {
    await rm(from, { recursive: true, force: true });
    await rm(root, { recursive: true, force: true });
  }
});

test('pull downloads the artifact of the latest CI run on the PR head', async () => {
  const root = await folder();
  const calls: Array<string> = [];
  const run: Run = async (command) => {
    calls.push(command.slice(0, 3).join(' '));
    if (command[1] === 'pr') {
      return { ok: true, out: 'abc1234\n', err: '' };
    }
    if (command[2] === 'list') {
      return { ok: true, out: '42\n', err: '' };
    }
    await put(command.at(-1) ?? '', baseline, 'ci pixels');
    return { ok: true, out: '', err: '' };
  };
  const lines: Array<string> = [];
  try {
    expect(await pull(run, root, '7', (line) => lines.push(line))).toBe(0);
    expect(calls).toEqual(['gh pr view', 'gh run list', 'gh run download']);
    expect(await readFile(path.join(root, baseline), 'utf-8')).toBe('ci pixels');
    expect(lines.at(-1)).toContain('1 added, 0 changed');
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

/** A `gh` that finds the run but has no screenshot artifact for it. */
const noArtifact: Run = (command) =>
  Promise.resolve(
    command[2] === 'download'
      ? { ok: false, out: '', err: 'no artifact' }
      : { ok: true, out: command[1] === 'pr' ? 'abc\n' : '42\n', err: '' },
  );

test('pull says so when the run has no screenshot artifact', async () => {
  const run = noArtifact;
  const lines: Array<string> = [];
  expect(await pull(run, '/nowhere', '7', (line) => lines.push(line))).toBe(1);
  expect(lines[0]).toContain('has no visual-screenshots artifact');
});
