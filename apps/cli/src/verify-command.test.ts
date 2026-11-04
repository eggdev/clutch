import { afterEach, expect, spyOn, test } from 'bun:test';

import { gitOrThrow } from '@/git';
import { fakeGitHub, head, png, shots } from '@/testing/fake-github';
import { verifyCommand } from '@/verify-command';

const out = spyOn(console, 'log').mockImplementation(() => {});
const err = spyOn(console, 'error').mockImplementation(() => {});
afterEach(() => {
  out.mockClear();
  err.mockClear();
});
const printed = () => out.mock.calls.map((call) => String(call[0])).join('\n');

test('clutch verify post reads the repository from origin and prints each link', async () => {
  await using files = await shots({ 'desktop.png': png('d') });
  await gitOrThrow(files.root, 'remote', 'add', 'origin', 'git@github.com:o/r.git');
  const github = fakeGitHub();
  expect(await verifyCommand(['post', '--pr', '7', ...files.files], files.root, github)).toBe(0);
  const { tip } = github.state;
  expect(printed()).toBe(
    `desktop: https://github.com/o/r/blob/${tip}/7/${head}/desktop.png?raw=true\nPosted https://c/1 (head aaaaaaa)`,
  );
  out.mockClear();
  const args = ['post', '--pr', '7', '--json', ...files.files];
  expect(await verifyCommand(args, files.root, github)).toBe(0);
  expect(JSON.parse(printed())).toMatchObject({
    schemaVersion: 1,
    status: 'posted',
    repo: 'o/r',
    pr: 7,
    head,
    comment: { url: 'https://c/1', edited: true },
  });
});

test('a bad argument exits 1 with the reason', async () => {
  await using files = await shots({ 'desktop.png': png('d') });
  const { gh } = fakeGitHub();
  expect(await verifyCommand(['show'], files.root, { gh })).toBe(1);
  expect(
    await verifyCommand(['post', '--pr', 'x', ...files.files], files.root, {
      gh,
    }),
  ).toBe(1);
  expect(
    await verifyCommand(['post', '--pr', '7', '--head', 'abc'], files.root, {
      gh,
    }),
  ).toBe(1);
  expect(
    await verifyCommand(['post', '--pr', '7', ...files.files], files.root, {
      gh,
    }),
  ).toBe(1);
  expect(err.mock.calls.map((call) => call[0])).toEqual([
    'Usage: clutch verify post --pr <number> <png>...',
    '--pr takes the number of a pull request.',
    '--head takes a full 40-character commit SHA.',
    'No GitHub origin remote. Pass --repo OWNER/NAME.',
  ]);
  expect(await verifyCommand(['post', '--pr', '7', '--json'], files.root, { gh })).toBe(1);
  expect(JSON.parse(printed())).toMatchObject({ status: 'error' });
});
