import { expect, test } from 'bun:test';
import { mkdir, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';

import { changesIn, maxRows, parseLog, sheet } from '@tools/journeys/visual-digest';
import type { Change } from '@tools/journeys/visual-digest';
import { inRepo } from '@tools/testing/in-repo';

const shots = 'features/notes/journeys/__screenshots__';

function git(root: string, ...args: Array<string>) {
  const run = Bun.spawnSync(['git', '-C', root, ...args], {
    env: {
      ...process.env,
      GIT_AUTHOR_NAME: 't',
      GIT_AUTHOR_EMAIL: 't@t',
      GIT_COMMITTER_NAME: 't',
      GIT_COMMITTER_EMAIL: 't@t',
    },
  });
  expect(run.exitCode).toBe(0);
}

async function commit(root: string, message: string, files: Record<string, string | null>) {
  for (const [file, body] of Object.entries(files)) {
    if (body === null) {
      await rm(path.join(root, file));
    } else {
      await mkdir(path.dirname(path.join(root, file)), { recursive: true });
      await writeFile(path.join(root, file), body);
    }
  }
  git(root, 'add', '-A');
  git(root, 'commit', '-q', '-m', message);
}

test('parseLog keeps each baseline change with its commit', () => {
  const log = `\0aaa\tfeat: blue buttons\n\nM\t${shots}/home-mobile-light.png\nM\tfeatures/notes/screens/notes-screen.tsx\n\0bbb\tfeat: notes\n\nA\t${shots}/notes-open-mobile-dark.png\nD\t${shots}/old-desktop-light.png\n`;
  expect(parseLog(log)).toEqual([
    {
      sha: 'aaa',
      subject: 'feat: blue buttons',
      path: `${shots}/home-mobile-light.png`,
      status: 'changed',
    },
    {
      sha: 'bbb',
      subject: 'feat: notes',
      path: `${shots}/notes-open-mobile-dark.png`,
      status: 'added',
    },
    {
      sha: 'bbb',
      subject: 'feat: notes',
      path: `${shots}/old-desktop-light.png`,
      status: 'removed',
    },
  ]);
});

test('changesIn reads the baseline changes of the checkout, newest first', async () => {
  await inRepo({}, async (root) => {
    git(root, 'init', '-q', '-b', 'main');
    await commit(root, 'feat: home', {
      [`${shots}/home-mobile-light.png`]: 'one',
      'README.md': 'x',
    });
    await commit(root, 'fix: home spacing', { [`${shots}/home-mobile-light.png`]: 'two' });
    await commit(root, 'docs: readme', { 'README.md': 'y' });
    await commit(root, 'refactor: drop home', { [`${shots}/home-mobile-light.png`]: null });
    const changes = await changesIn(root, 7);
    expect(changes.map((change) => `${change.status} ${change.subject}`)).toEqual([
      'removed refactor: drop home',
      'changed fix: home spacing',
      'added feat: home',
    ]);
  });
});

test('the sheet shows before at the parent commit and after at the commit', () => {
  const changes: Array<Change> = [
    {
      sha: 'abcdef1234',
      subject: 'fix: a | b',
      path: `${shots}/home-mobile-light.png`,
      status: 'changed',
    },
    {
      sha: 'abcdef1234',
      subject: 'fix: a | b',
      path: `${shots}/notes-open-mobile-dark.png`,
      status: 'added',
    },
  ];
  const text = sheet(changes, 'eggdev/neighborhood', 7);
  expect(text).toContain('### Visual changes (last 7 days)');
  expect(text).toContain('2 baseline(s) changed in 1 commit(s).');
  expect(text).toContain(
    `https://github.com/eggdev/neighborhood/blob/abcdef1234^/${shots}/home-mobile-light.png?raw=true`,
  );
  expect(text).toContain(`| \`notes-open-mobile-dark\` | new |`);
  expect(text).toContain(
    '[abcdef1](https://github.com/eggdev/neighborhood/commit/abcdef1234) fix: a \\| b',
  );
  expect(sheet([], 'eggdev/neighborhood', 7)).toContain('No screenshot baseline changed.');
});

test('the sheet counts the changes past its row limit', () => {
  const many = Array.from({ length: maxRows + 3 }, (_, index) => ({
    sha: `sha${index}`,
    subject: 's',
    path: `${shots}/s${index}-mobile-light.png`,
    status: 'changed' as const,
  }));
  expect(sheet(many, 'eggdev/clutch', 7)).toContain('3 more change(s) are not shown.');
});
