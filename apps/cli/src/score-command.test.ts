import { afterEach, expect, spyOn, test } from 'bun:test';

import type { Gh } from '@/doctor/remote';
import { scoreCommand } from '@/score-command';
import { gitRepo } from '@/testing/git-repo';

const sha = 'c'.repeat(40);
const tree = {
  'clutch.yaml':
    'schemaVersion: 1\nproject: shop\ntemplate:\n  repo: eggdev/clutch\n  mode: sync\ncapabilities: {}\n',
  'factory/models.yaml':
    'models:\n  - id: opus\n    harness: claude\n  - id: qwen\n    harness: qwen\n    base_url: http://judge.test/v1\n',
  'factory/runners/box.yaml':
    'description: A box.\nmachine: box\nt3_environment: local\nworkspace: worktree\n',
  'factory/agents/implement/agent.md':
    '---\nrole: implement\ndescription: An agent.\nharness: claude\nmodel: opus\nrunner: box\n---\n\nWork.\n',
  'factory/scorers/fit/scorer.md':
    '---\nagents: [implement]\njudge: qwen\nlabels:\n  - value: pass\n    score: 1\n    description: Done.\n  - value: fail\n    score: 0\n    description: Not done.\npassingScore: 1\nsamplingRate: 0\n---\n\nJudge it.\n',
};

const gh: Gh = (args) => {
  const route = args.at(-1) ?? '';
  const out = route.endsWith('/files?per_page=100&page=1')
    ? '[]'
    : JSON.stringify({
        html_url: 'https://github.com/o/r/pull/3',
        title: 'fix: a thing',
        body: null,
        head: { sha, ref: 'fix-thing' },
      });
  return Promise.resolve({ ok: route.startsWith('repos/o/r/pulls/3'), out, err: '' });
};
const judge = () =>
  Promise.resolve(
    Response.json({
      choices: [{ message: { content: '{"label": "pass", "reason": "It is done."}' } }],
    }),
  );

const out = spyOn(console, 'log').mockImplementation(() => {});
const err = spyOn(console, 'error').mockImplementation(() => {});
afterEach(() => {
  out.mockClear();
  err.mockClear();
});
const printed = () => out.mock.calls.map((call) => String(call[0])).join('\n');

test('clutch score finds the tree from clutch.yaml and prints the score', async () => {
  await using repo = await gitRepo(tree);
  const deps = { gh, fetch: judge };
  expect(await scoreCommand(['fit', '--pr', '3', '--repo', 'o/r'], repo.root, deps)).toBe(0);
  expect(printed()).toBe(
    `fit passes o/r#3: pass (score 1, passing score 1).\nIt is done.\nJudge qwen, ${/Judge qwen, (\S+) s/u.exec(printed())?.[1]} s, head ccccccc.`,
  );
  out.mockClear();
  expect(await scoreCommand(['fit', '--pr', '3', '--repo', 'o/r', '--json'], repo.root, deps)).toBe(
    0,
  );
  expect(JSON.parse(printed())).toMatchObject({
    schemaVersion: 1,
    status: 'scored',
    scorer: 'fit',
    label: 'pass',
    score: 1,
    passed: true,
    head: sha,
  });
});

test('--sample skips a PR outside the rate, and --root reads another tree', async () => {
  await using repo = await gitRepo(tree);
  const args = ['fit', '--pr', '3', '--repo', 'o/r', '--sample', '--root', `${repo.root}/factory`];
  expect(await scoreCommand(args, '/', { gh, fetch: judge })).toBe(0);
  expect(printed()).toBe('fit skips o/r#3: it is outside the 0% sample.');
});

test('a bad argument or a missing scorer exits 1 with the reason', async () => {
  await using repo = await gitRepo(tree);
  expect(await scoreCommand(['--pr', '3'], repo.root, { gh })).toBe(1);
  expect(await scoreCommand(['fit', '--pr', 'x'], repo.root, { gh })).toBe(1);
  expect(
    await scoreCommand(['nope', '--pr', '3', '--repo', 'o/r', '--json'], repo.root, { gh }),
  ).toBe(1);
  expect(err.mock.calls.map((call) => call[0])).toEqual([
    'Name one scorer: clutch score <scorer> --pr <number>.',
    '--pr takes the number of a pull request.',
  ]);
  expect(JSON.parse(printed())).toMatchObject({
    status: 'error',
    message: expect.stringContaining('No scorer nope'),
  });
});
