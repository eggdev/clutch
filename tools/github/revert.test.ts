import { expect, test } from 'bun:test';

import { revertTitle, runRevert } from '@tools/github/revert';
import type { Result, Run } from '@tools/github/stack';

const sha = 'abc1234def5678';

/** A fake runner for a merge commit with two parents. `answers` override by command prefix. */
function fake(answers: Array<[string, Partial<Result>]> = []) {
  const calls: Array<string> = [];
  const defaults: Array<[string, Partial<Result>]> = [
    ['git ls-remote', { ok: false }],
    ['git rev-list', { out: `${sha} p1 p2\n` }],
    ['gh pr create', { out: 'https://github.com/acme/shop/pull/90\n' }],
  ];
  const run: Run = (command) => {
    const line = command.join(' ');
    calls.push(line);
    const answer = [...answers, ...defaults].find(([prefix]) => line.startsWith(prefix))?.[1];
    return Promise.resolve({ ok: true, out: '', err: '', ...answer });
  };
  return { run, calls };
}

const args = [
  '--pr',
  '75',
  '--sha',
  sha,
  '--title',
  'docs(skills): add x (CL-119)',
  '--base',
  'main',
];

async function revert(gh: ReturnType<typeof fake>) {
  const written: Array<[string, string]> = [];
  const lines: Array<string> = [];
  const code = await runRevert(args, gh.run, {
    write: (file, text) => {
      written.push([file.split('/').slice(-2).join('/'), text]);
      return Promise.resolve();
    },
    log: (line) => lines.push(line),
    env: { GITHUB_REPOSITORY: 'acme/shop', PUSH_TOKEN: 'bot' },
  });
  return { code, written, lines };
}

test('the revert title is a conventional revert: that fits one commit line', () => {
  expect(revertTitle('feat(cli): add x (CL-1)')).toBe('revert: feat(cli): add x (CL-1)');
  const long = revertTitle(`feat(cli): ${'word '.repeat(20)}`);
  expect(long.length).toBeLessThanOrEqual(72);
  expect(long).toStartWith('revert: feat(cli): word');
  expect(long).toEndWith('...');
});

test('a merged PR is reverted on revert/<n> with a changeset, pushed with the bot token and linked', async () => {
  const gh = fake();
  const { code, written, lines } = await revert(gh);
  expect(code).toBe(0);
  expect(gh.calls).toContain('git switch --create revert/75 origin/main');
  expect(gh.calls).toContain(`git revert --no-commit -m 1 ${sha}`);
  expect(written).toEqual([
    [
      '.changeset/revert-75.md',
      '---\n"clutch": patch\n---\n\nrevert: docs(skills): add x (CL-119)\n',
    ],
  ]);
  expect(gh.calls).toContain(
    `git commit --message revert: docs(skills): add x (CL-119)\n\nThis reverts #75, merge commit ${sha}.`,
  );
  expect(gh.calls).toContain(
    'git push https://x-access-token:bot@github.com/acme/shop.git HEAD:refs/heads/revert/75',
  );
  const create = gh.calls.find((call) => call.startsWith('gh pr create')) ?? '';
  expect(create).toContain('--title revert: docs(skills): add x (CL-119)');
  expect(create).toContain(`Reverts #75 (merge commit ${sha})`);
  expect(gh.calls).toContain(
    'gh pr comment 75 --body Reverted in https://github.com/acme/shop/pull/90. Reply here with the reason for the revert, so the next change avoids it.',
  );
  expect(lines).toEqual(['Opened https://github.com/acme/shop/pull/90.']);
});

test('a single-parent commit reverts without -m, and an existing branch is left alone', async () => {
  const squash = fake([['git rev-list', { out: `${sha} p1\n` }]]);
  await revert(squash);
  expect(squash.calls).toContain(`git revert --no-commit ${sha}`);
  const again = fake([['git ls-remote', { ok: true }]]);
  const { code, lines } = await revert(again);
  expect(code).toBe(0);
  expect(again.calls).toHaveLength(1);
  expect(lines).toEqual(['revert/75 already exists. Its revert PR is open or done.']);
});

test('a conflicting revert aborts, comments on the PR and opens nothing', async () => {
  const gh = fake([['git revert --no-commit', { ok: false, err: 'conflict' }]]);
  const { code } = await revert(gh);
  expect(code).toBe(1);
  expect(gh.calls).toContain('git revert --abort');
  expect(gh.calls.some((call) => call.startsWith('gh pr create'))).toBe(false);
  expect(gh.calls.find((call) => call.startsWith('gh pr comment 75'))).toContain(
    'could not revert abc1234 cleanly',
  );
});

test('a missing argument gives the usage', async () => {
  await expect(runRevert(['--pr', '75'], fake().run)).rejects.toThrow(
    'Usage: bun tools/github/revert.ts',
  );
});
