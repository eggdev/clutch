import { expect, test } from 'bun:test';

import { fake, noWrite, trunk } from '@tools/github/fake-run';
import { runPr } from '@tools/github/pr';
import type { Result, Run } from '@tools/github/stack';

const issueRecord = (status: string, pr = ''): [string, Partial<Result>] => [
  'bun tools/clutch.ts issues --json',
  {
    out: JSON.stringify({
      issues: [{ id: 'CL-123', status, pr, file: '.clutch/issues/CL-123.md' }],
    }),
  },
];
const openPr = (url = 'https://github.com/o/r/pull/12'): [string, Partial<Result>] => [
  'gh pr list --state open --head clutch/cl-123-x',
  { out: JSON.stringify([{ number: 12, baseRefName: 'main', url, isDraft: false }]) },
];
const marked =
  'git commit --quiet --message chore(tracker): mark CL-123 done -- .clutch/issues/CL-123.md';

test('open marks the branch issue done in its own commit, before the push', async () => {
  let created = false;
  const gh = fake([
    trunk,
    ['git branch --show-current', { out: 'clutch/cl-123-x\n' }],
    issueRecord('in_progress'),
  ]);
  const run: Run = (command, options) => {
    const line = command.join(' ');
    if (line.startsWith('gh pr create')) {
      created = true;
    }
    if (line.startsWith('gh pr list --state open --head clutch/cl-123-x')) {
      gh.calls.push(line);
      return Promise.resolve({
        ok: true,
        out: created
          ? JSON.stringify([{ number: 12, baseRefName: 'main', url: 'u', isDraft: false }])
          : '[]',
        err: '',
      });
    }
    return gh.run(command, options);
  };
  expect(
    await runPr(['open', '--title', 'feat: add it', '--body-file', 'body.md'], run, noWrite),
  ).toBe(0);
  const set = gh.calls.indexOf('bun tools/clutch.ts issues set CL-123 done');
  const commit = gh.calls.indexOf(marked);
  const push = gh.calls.indexOf('git push --set-upstream origin HEAD');
  expect(set).toBeGreaterThan(-1);
  expect(commit).toBeGreaterThan(set);
  expect(push).toBeGreaterThan(commit);
  expect(gh.calls).toContain('git add .clutch/issues/CL-123.md');
});

test('open on an issue that is done with this PR link makes no tracker commit, and still pushes', async () => {
  const gh = fake([
    trunk,
    ['git branch --show-current', { out: 'clutch/cl-123-x\n' }],
    issueRecord('done', 'https://github.com/o/r/pull/12'),
    openPr(),
  ]);
  expect(
    await runPr(['open', '--title', 'feat: add it', '--body-file', 'body.md'], gh.run, noWrite),
  ).toBe(0);
  expect(gh.calls.some((call) => call.includes(' issues set '))).toBe(false);
  expect(gh.calls).not.toContain(marked);
  expect(gh.calls).toContain('git push --set-upstream origin HEAD');
});

test('open adds the PR link to an issue that is done without one', async () => {
  const gh = fake([
    trunk,
    ['git branch --show-current', { out: 'clutch/cl-123-x\n' }],
    issueRecord('done'),
    openPr(),
  ]);
  await runPr(['open', '--title', 'feat: add it', '--body-file', 'body.md'], gh.run, noWrite);
  expect(gh.calls).toContain(
    'bun tools/clutch.ts issues set CL-123 done --pr https://github.com/o/r/pull/12',
  );
  expect(gh.calls).toContain(marked);
});

test('open on a branch with no issue id makes no tracker call and no tracker commit', async () => {
  const gh = fake([
    trunk,
    ['git branch --show-current', { out: 'clutch/notes\n' }],
    [
      'gh pr list --state open --head clutch/notes',
      { out: '[{"number":3,"baseRefName":"main","url":"u","isDraft":false}]' },
    ],
  ]);
  expect(
    await runPr(['open', '--title', 'feat: add it', '--body-file', 'body.md'], gh.run, noWrite),
  ).toBe(0);
  expect(gh.calls.some((call) => call.includes('issues'))).toBe(false);
  expect(gh.calls.some((call) => call.includes('chore(tracker)'))).toBe(false);
});
