import { expect, test } from 'bun:test';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { isGreen, previousRun, readWatch, runAutoRevert } from '@tools/github/auto-revert';
import { fake } from '@tools/github/fake-run';
import type { Result } from '@tools/github/stack';

const env = { GITHUB_REPOSITORY: 'acme/shop' };
const args = (attempt: string) => [
  '--sha',
  'red1234',
  '--branch',
  'main',
  '--run-id',
  '77',
  '--attempt',
  attempt,
];

/** The push runs of CI on main, newest first: the red one, a cancelled one, and the one before. */
const runs = (before: string) => ({
  out: JSON.stringify([
    { headSha: 'red1234', conclusion: 'failure', status: 'completed' },
    { headSha: 'gone', conclusion: 'cancelled', status: 'completed' },
    { headSha: 'old5678', conclusion: before, status: 'completed' },
  ]),
});

/** A job of a push run, as `[name, conclusion]`. */
type Job = [string, string];

/**
 * The jobs of the push run `id` on commit `sha`. Each job gets an id that grows
 * with its position, as GitHub's job ids do.
 */
function commit(sha: string, id: number, jobs: Array<Job>): Array<[string, Partial<Result>]> {
  const out = jobs
    .map(([name, conclusion], index) =>
      JSON.stringify({ id: id * 100 + index, name, status: 'completed', conclusion }),
    )
    .join('\n');
  return [
    [`gh api --paginate repos/acme/shop/actions/runs?head_sha=${sha}`, { out: `${id}\n` }],
    [`gh api --paginate repos/acme/shop/actions/runs/${id}/jobs`, { out }],
  ];
}

/**
 * A merge of #42 that main was green before. The required check is `validate`,
 * and `production` is a job that is not required. `answers` come first.
 */
function main(answers: Array<[string, Partial<Result>]> = []) {
  return fake([
    ...answers,
    ['gh run list', runs('success')],
    ['gh api repos/acme/shop/rules/branches/main', { out: '["validate"]' }],
    ...commit('red1234', 41, [['validate', 'failure']]),
    ...commit('old5678', 40, [['validate', 'success']]),
    [
      'gh api repos/acme/shop/commits/red1234 ',
      { out: JSON.stringify({ message: 'Merge pull request #42', parents: ['a', 'b'] }) },
    ],
    ['gh api repos/acme/shop/commits/red1234/pulls', { out: '42\n' }],
    ['gh api --paginate repos/acme/shop/issues/42/comments', { out: '901\n' }],
  ]);
}

async function autoRevert(gh: ReturnType<typeof fake>, attempt = '2', watch: Array<string> = []) {
  const lines: Array<string> = [];
  const code = await runAutoRevert(args(attempt), gh.run, {
    log: (line) => lines.push(line),
    env,
    watch,
  });
  return { code, lines };
}

const reverted = (gh: ReturnType<typeof fake>) =>
  gh.calls.includes('gh api --method POST repos/acme/shop/issues/42/labels -f labels[]=revert');
const reran = (gh: ReturnType<typeof fake>) =>
  gh.calls.some((call) => call.startsWith('gh run rerun'));

test('the previous run is the last finished push run, past a cancelled one', () => {
  const list = JSON.parse(runs('success').out);
  expect(previousRun(list, 'red1234')?.headSha).toBe('old5678');
  expect(previousRun(list, 'old5678')).toBeUndefined();
  expect(previousRun(list, 'missing')).toBeUndefined();
});

/** A check run with a status and a conclusion. */
const check = (conclusion: string | null, status = 'completed') => ({ status, conclusion });

test('green before means every check that ran passed, and a skipped or missing one is aside', () => {
  expect(
    isGreen(
      new Map([
        ['validate', check('success')],
        ['commits', check('skipped')],
      ]),
      ['validate', 'commits', 'agent-review'],
    ),
  ).toBe(true);
  expect(isGreen(new Map([['validate', check('failure')]]), ['validate'])).toBe(false);
  expect(isGreen(new Map([['validate', check(null, 'in_progress')]]), ['validate'])).toBe(false);
  expect(isGreen(new Map([['validate', check('skipped')]]), ['validate'])).toBe(false);
  expect(isGreen(new Map(), ['validate'])).toBe(false);
});

test('a required check red after required green reverts the auto-merged PR', async () => {
  const gh = main();
  const { code } = await autoRevert(gh);
  expect(code).toBe(0);
  expect(gh.calls).toContain('gh api --method POST repos/acme/shop/issues/42/labels -f labels[]=revert');
  expect(gh.calls).toContain('gh workflow run revert.yml --repo acme/shop --ref main -f pr=42');
  expect(gh.calls.some((call) => call.startsWith('gh pr comment 42'))).toBe(true);
});

test('the revert label is created before it is added, so a fresh project has it', async () => {
  const gh = main();
  await autoRevert(gh);
  const create = gh.calls.findIndex((call) => call.startsWith('gh label create revert --force'));
  const add = gh.calls.indexOf(
    'gh api --method POST repos/acme/shop/issues/42/labels -f labels[]=revert',
  );
  expect(create).toBeGreaterThanOrEqual(0);
  expect(create).toBeLessThan(add);
  expect(gh.calls[create]).toContain('--repo acme/shop');
  expect(gh.calls[create]).toContain('--color e99695');
});

test('a failed label add stops the revert, so no revert workflow starts without the label', async () => {
  const gh = main([
    ['gh api --method POST repos/acme/shop/issues/42/labels', { ok: false, err: 'HTTP 422' }],
  ]);
  await expect(autoRevert(gh)).rejects.toThrow('HTTP 422');
  expect(gh.calls.some((call) => call.startsWith('gh workflow run'))).toBe(false);
});

test('a label create the job may not grant does not stop the revert', async () => {
  const gh = main([['gh label create revert', { ok: false, err: 'HTTP 403' }]]);
  const { code, lines } = await autoRevert(gh);
  expect(code).toBe(0);
  expect(reverted(gh)).toBe(true);
  expect(lines.at(-1)).toContain('Started its revert.');
});

test('the first red run only reruns the failed jobs, in case a test is flaky', async () => {
  const gh = main();
  await autoRevert(gh, '1');
  expect(gh.calls).toContain('gh run rerun 77 --failed --repo acme/shop');
  expect(reverted(gh)).toBe(false);
});

test('a branch that was red before gets no rerun and no revert', async () => {
  const gh = main([...commit('old5678', 40, [['validate', 'failure']])]);
  const { lines } = await autoRevert(gh, '1');
  expect(lines[0]).toContain('was not green before');
  expect(reran(gh)).toBe(false);
});

test('only a check that is not required failed: no rerun and no revert', async () => {
  for (const attempt of ['1', '2']) {
    const gh = main([
      ...commit('red1234', 41, [
        ['validate', 'success'],
        ['production', 'failure'],
      ]),
    ]);
    const { lines } = await autoRevert(gh, attempt);
    expect(lines).toEqual(['Only checks that are not required failed (production), so no revert.']);
    expect(reran(gh)).toBe(false);
    expect(reverted(gh)).toBe(false);
  }
});

test('a previous commit where production failed counts as green when the required checks passed', async () => {
  const gh = main([
    ['gh run list', runs('failure')],
    ...commit('old5678', 40, [
      ['validate', 'success'],
      ['production', 'failure'],
    ]),
  ]);
  await autoRevert(gh);
  expect(reverted(gh)).toBe(true);
});

test('autoRevert.watch makes a failed production job revert', async () => {
  const gh = main([
    ...commit('red1234', 41, [
      ['validate', 'success'],
      ['production', 'failure'],
    ]),
    ...commit('old5678', 40, [
      ['validate', 'success'],
      ['production', 'success'],
    ]),
  ]);
  const { lines } = await autoRevert(gh, '2', ['production']);
  expect(lines[0]).toContain('Started its revert');
  expect(reverted(gh)).toBe(true);
});

test('a watched check that failed on the commit before is not green before', async () => {
  const gh = main([
    ...commit('red1234', 41, [
      ['validate', 'success'],
      ['production', 'failure'],
    ]),
    ...commit('old5678', 40, [
      ['validate', 'success'],
      ['production', 'failure'],
    ]),
  ]);
  const { lines } = await autoRevert(gh, '2', ['production']);
  expect(lines[0]).toContain('was not green before');
  expect(reverted(gh)).toBe(false);
});

test('a red release commit blames the merge before it', async () => {
  const gh = main([
    [
      'gh api repos/acme/shop/commits/red1234 ',
      { out: JSON.stringify({ message: 'chore(release): v1.2.0', parents: ['merge99'] }) },
    ],
    ['gh api repos/acme/shop/commits/merge99/pulls', { out: '42\n' }],
  ]);
  await autoRevert(gh);
  expect(gh.calls).toContain('gh api --method POST repos/acme/shop/issues/42/labels -f labels[]=revert');
});

test('a PR that a person merged, or a commit with no PR, is not reverted', async () => {
  const person = main([['gh api --paginate repos/acme/shop/issues/42/comments', { out: '' }]]);
  const merged = await autoRevert(person);
  expect(merged.lines[0]).toContain('A person merged #42');
  const direct = main([['gh api repos/acme/shop/commits/red1234/pulls', { out: '' }]]);
  const unmerged = await autoRevert(direct);
  expect(unmerged.lines[0]).toContain('is not the merge of a pull request');
  for (const gh of [person, direct]) {
    expect(gh.calls.some((call) => call.startsWith('gh workflow run'))).toBe(false);
  }
});

test('the watch list comes from autoRevert in clutch.yaml, and a bad one fails', async () => {
  const dir = await mkdtemp(path.join(tmpdir(), 'auto-revert-'));
  const file = path.join(dir, 'clutch.yaml');
  const base =
    'schemaVersion: 1\nproject: shop\ntemplate:\n  repo: eggdev/clutch\n  mode: sync\ncapabilities: {}\n';
  try {
    expect(await readWatch(file)).toEqual([]);
    await writeFile(file, `${base}autoRevert:\n  watch: [production]\n`);
    expect(await readWatch(file)).toEqual(['production']);
    await writeFile(file, `${base}autoRevert:\n  watch: production\n`);
    await expect(readWatch(file)).rejects.toThrow('clutch.yaml: autoRevert must be a map');
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test('a missing argument gives the usage', async () => {
  const gh = main();
  await expect(runAutoRevert(['--sha', 'x'], gh.run, { env })).rejects.toThrow('Usage');
});
