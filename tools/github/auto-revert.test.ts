import { expect, test } from 'bun:test';

import { previousConclusion, runAutoRevert } from '@tools/github/auto-revert';
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

const runs = (before: string) => ({
  out: JSON.stringify([
    { headSha: 'red1234', conclusion: 'failure', status: 'completed' },
    { headSha: 'gone', conclusion: 'cancelled', status: 'completed' },
    { headSha: 'old5678', conclusion: before, status: 'completed' },
  ]),
});

/** A merge of #42 that main was green before, with `answers` first. */
function main(answers: Array<[string, Partial<Result>]> = []) {
  return fake([
    ...answers,
    ['gh run list', runs('success')],
    [
      'gh api repos/acme/shop/commits/red1234 ',
      { out: JSON.stringify({ message: 'Merge pull request #42', parents: ['a', 'b'] }) },
    ],
    ['gh api repos/acme/shop/commits/red1234/pulls', { out: '42\n' }],
    ['gh api --paginate repos/acme/shop/issues/42/comments', { out: '901\n' }],
  ]);
}

async function autoRevert(gh: ReturnType<typeof fake>, attempt = '2') {
  const lines: Array<string> = [];
  const code = await runAutoRevert(args(attempt), gh.run, { log: (line) => lines.push(line), env });
  return { code, lines };
}

test('the run before is the last finished push run, past a cancelled one', () => {
  const list = JSON.parse(runs('success').out);
  expect(previousConclusion(list, 'red1234')).toBe('success');
  expect(previousConclusion(list, 'old5678')).toBeNull();
  expect(previousConclusion(list, 'missing')).toBeNull();
});

test('a second red run after a green one reverts the auto-merged PR', async () => {
  const gh = main();
  const { code } = await autoRevert(gh);
  expect(code).toBe(0);
  expect(gh.calls).toContain('gh pr edit 42 --repo acme/shop --add-label revert');
  expect(gh.calls).toContain('gh workflow run revert.yml --repo acme/shop --ref main -f pr=42');
  expect(gh.calls.some((call) => call.startsWith('gh pr comment 42'))).toBe(true);
});

test('the revert label is created before it is added, so a fresh project has it', async () => {
  const gh = main();
  await autoRevert(gh);
  const create = gh.calls.findIndex((call) => call.startsWith('gh label create revert --force'));
  const add = gh.calls.indexOf('gh pr edit 42 --repo acme/shop --add-label revert');
  expect(create).toBeGreaterThanOrEqual(0);
  expect(create).toBeLessThan(add);
  expect(gh.calls[create]).toContain('--repo acme/shop');
  expect(gh.calls[create]).toContain('--color e99695');
});

test('a label create the job may not grant does not stop the revert', async () => {
  const gh = main([['gh label create revert', { ok: false, err: 'HTTP 403' }]]);
  const { code, lines } = await autoRevert(gh);
  expect(code).toBe(0);
  expect(gh.calls).toContain('gh pr edit 42 --repo acme/shop --add-label revert');
  expect(lines.at(-1)).toContain('Started its revert.');
});

test('the first red run only reruns the failed jobs, in case a test is flaky', async () => {
  const gh = main();
  await autoRevert(gh, '1');
  expect(gh.calls).toContain('gh run rerun 77 --failed --repo acme/shop');
  expect(gh.calls.some((call) => call.startsWith('gh pr edit'))).toBe(false);
});

test('a branch that was red before gets no rerun and no revert', async () => {
  const gh = main([['gh run list', runs('failure')]]);
  const { lines } = await autoRevert(gh, '1');
  expect(lines[0]).toContain('was not green before');
  expect(gh.calls.some((call) => call.startsWith('gh run rerun'))).toBe(false);
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
  expect(gh.calls).toContain('gh pr edit 42 --repo acme/shop --add-label revert');
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

test('a missing argument gives the usage', async () => {
  const gh = main();
  await expect(runAutoRevert(['--sha', 'x'], gh.run, { env })).rejects.toThrow('Usage');
});
