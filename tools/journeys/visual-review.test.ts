import { expect, test } from 'bun:test';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';

import {
  comment,
  failures,
  marker,
  parseChanges,
  prompt,
  report,
} from '@tools/journeys/visual-review';
import type { Change, Result, Run } from '@tools/journeys/visual-review';

const shots = 'features/notes/journeys/__screenshots__';
const changes: Array<Change> = [
  { path: `${shots}/home-mobile-light.png`, status: 'changed' },
  { path: `${shots}/notes-open-desktop-dark.png`, status: 'added' },
  { path: `${shots}/old-mobile-dark.png`, status: 'removed' },
];
const verdict = (file: string, explained = true, broken = false) => ({
  path: file,
  explained,
  broken,
  note: 'The button is blue.',
});
const where = { repo: 'eggdev/clutch', base: 'aaaaaaa111', head: 'bbbbbbb222' };

test('parseChanges keeps only the baselines, with what happened to each', () => {
  expect(
    parseChanges(
      [
        `M\t${shots}/home-mobile-light.png`,
        `A\t${shots}/notes-open-desktop-dark.png`,
        `D\t${shots}/old-mobile-dark.png`,
        'M\tfeatures/notes/screens/notes-screen.tsx',
        'M\tdocs/logo.png',
        '',
      ].join('\n'),
    ),
  ).toEqual(changes);
});

test('the prompt holds the intent and a before and after for each pair', () => {
  const text = prompt({ title: 'feat: blue buttons', body: 'Buttons turn blue.' }, changes, '/out');
  expect(text).toContain('Title: feat: blue buttons');
  expect(text).toContain('Buttons turn blue.');
  expect(text).toContain(`before: /out/before/${shots}/home-mobile-light.png`);
  expect(text).toContain('before: none (a new baseline)');
  expect(text).toContain('after: none (the baseline is removed)');
  expect(prompt({ title: 't', body: '' }, changes, '/out')).toContain('(The PR body is empty.)');
});

test('a pair fails when it is unexplained, broken or left out', () => {
  const result: Result = {
    summary: 's',
    pairs: [verdict(changes[0]?.path ?? ''), verdict(changes[1]?.path ?? '', false)],
  };
  expect(failures(changes, result)).toEqual([
    `${shots}/notes-open-desktop-dark.png: the PR does not explain this change. The button is blue.`,
    `${shots}/old-mobile-dark.png: the review gave no verdict.`,
  ]);
  expect(
    failures(changes.slice(0, 1), {
      summary: 's',
      pairs: [verdict(changes[0]?.path ?? '', true, true)],
    }),
  ).toEqual([`${shots}/home-mobile-light.png: looks broken. The button is blue.`]);
  expect(failures(changes, null)).toHaveLength(3);
});

test('the comment shows before at the base and after at the head', () => {
  const result: Result = {
    summary: 'Blue buttons.',
    pairs: changes.map((change) => verdict(change.path)),
  };
  const text = comment(changes, result, where);
  expect(text.startsWith(marker)).toBe(true);
  expect(text).toContain('**Visual review passed.** 3 screenshot(s) changed');
  expect(text).toContain(
    `https://github.com/eggdev/clutch/blob/aaaaaaa111/${shots}/home-mobile-light.png?raw=true`,
  );
  expect(text).toContain(
    `https://github.com/eggdev/clutch/blob/bbbbbbb222/${shots}/home-mobile-light.png?raw=true`,
  );
  expect(text).toContain('| `notes-open-desktop-dark` | new |');
  expect(text).toContain('| removed | ✅');
  expect(comment(changes, null, where)).toContain('**Visual review blocks this PR.** 3 of 3');
});

/** Runs `report` against a fake `gh` that has `existing` as the comment ids. */
async function reportWith(existing: string) {
  const out = await mkdtemp(path.join(tmpdir(), 'visual-review-'));
  const calls: Array<Array<string>> = [];
  const run: Run = (command) => {
    calls.push(command);
    return Promise.resolve({
      ok: true,
      out: command.includes('--paginate') ? existing : '',
      err: '',
    });
  };
  try {
    await writeFile(path.join(out, 'changes.json'), JSON.stringify(changes.slice(0, 1)));
    const failed = await report(run, out, {
      REPO: 'eggdev/clutch',
      PR: '7',
      BASE_SHA: where.base,
      HEAD_SHA: where.head,
      RESULT: JSON.stringify({ summary: 's', pairs: [verdict(changes[0]?.path ?? '')] }),
    });
    return { failed, calls };
  } finally {
    await rm(out, { recursive: true, force: true });
  }
}

test('report edits its comment when one exists, and posts one otherwise', async () => {
  const edited = await reportWith('991\n');
  expect(edited.failed).toEqual([]);
  expect(edited.calls).toHaveLength(2);
  expect(edited.calls[1]?.slice(0, 5)).toEqual([
    'gh',
    'api',
    '--method',
    'PATCH',
    'repos/eggdev/clutch/issues/comments/991',
  ]);
  const posted = await reportWith('');
  expect(posted.calls[1]?.slice(3, 5)).toEqual(['POST', 'repos/eggdev/clutch/issues/7/comments']);
});
