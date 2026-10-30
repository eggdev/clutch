import { expect, test } from 'bun:test';

import { marker } from '@tools/github/auto-merge';
import { readJobLog } from '@tools/github/failures';
import type { Clock } from '@tools/github/github';
import { runPr } from '@tools/github/pr';
import type { Result, Run } from '@tools/github/stack';
import { blockingCount, prStatus } from '@tools/github/status';

/**
 * A fake runner for `gh` and `git`. Each answer matches a command by prefix,
 * the first match wins, and a list of answers is used in turn. Calls are kept.
 */
function fake(answers: Array<[string, Partial<Result> | Array<Partial<Result>>]>) {
  const calls: Array<string> = [];
  const used = new Map<string, number>();
  const run: Run = (command) => {
    const line = command.join(' ');
    calls.push(line);
    const found = answers.find(([prefix]) => line.startsWith(prefix));
    let answer: Partial<Result> = {};
    if (found) {
      const [prefix, value] = found;
      const index = used.get(prefix) ?? 0;
      used.set(prefix, index + 1);
      answer = Array.isArray(value) ? (value[Math.min(index, value.length - 1)] ?? {}) : value;
    }
    return Promise.resolve({ ok: true, out: '', err: '', ...answer });
  };
  return { run, calls };
}

/** A clock that moves forward on each sleep and never waits. */
function fakeClock(): Clock & { slept: number } {
  const clock = {
    slept: 0,
    now: () => clock.slept,
    sleep: (ms: number) => {
      clock.slept += ms;
      return Promise.resolve();
    },
  };
  return clock;
}

const noWrite = () => Promise.resolve();
const head = 'abc1234def';
const check = (name: string, conclusion: string, status = 'COMPLETED') => ({
  __typename: 'CheckRun',
  name,
  status,
  conclusion,
  detailsUrl: `https://github.com/o/r/actions/runs/1/job/${name.length}`,
});
const view = (rollup: Array<object>) => ({
  out: JSON.stringify({
    number: 7,
    url: 'https://github.com/o/r/pull/7',
    state: 'OPEN',
    headRefOid: head,
    baseRefName: 'main',
    mergeable: 'MERGEABLE',
    mergeStateStatus: 'CLEAN',
    statusCheckRollup: rollup,
  }),
});
const rules: [string, Partial<Result>] = [
  'gh api repos/{owner}/{repo}/rules/branches/main',
  { out: '["validate","agent-review"]' },
];
const comment = (body: string) => JSON.stringify({ body, login: 'github-actions[bot]' });
const comments = (...bodies: Array<string>) =>
  [
    'gh api --paginate repos/{owner}/{repo}/issues/7/comments',
    { out: bodies.map(comment).join('\n') },
  ] as [string, Partial<Result>];

test('the blocking count reads each way the agent words it', () => {
  expect(blockingCount('## Agent review\n\n**Blocking findings: 0**')).toBe(0);
  expect(blockingCount('## Agent review\n\nFindings: 3 (2 blocking)')).toBe(2);
  expect(blockingCount('## Agent review\n\nFindings, 1 blocking:')).toBe(1);
  expect(blockingCount('## Agent review\n\nRules: review.md\n\n**Blocking: 0**\n\n- note: x')).toBe(
    0,
  );
  expect(blockingCount('## Agent review\n\nFindings, 0 blocking:\n\n- 2 notes')).toBe(0);
  expect(blockingCount('## Agent review\n\nNo findings.')).toBe(0);
  expect(blockingCount('## Agent review\n\nSomething else.')).toBeNull();
});

test('status reads the checks, the latest review, the dry run and the merge state', async () => {
  const gh = fake([
    ['gh pr view 7', view([check('validate', 'SUCCESS'), check('agent-review', 'SUCCESS')])],
    rules,
    comments(
      '## Agent review\n\nBlocking findings: 2',
      `${marker(head)}\n**Auto-merge dry run:** this pull request would not auto-merge at abc1234.`,
      '## Agent review\n\nBlocking findings: 0',
    ),
  ]);
  const status = await prStatus(gh.run, '7');
  expect(status).toMatchObject({
    head,
    mergeable: 'MERGEABLE',
    required: [
      { name: 'validate', state: 'pass' },
      { name: 'agent-review', state: 'pass' },
    ],
    agentReview: { blocking: 0 },
    dryRun: 'would not',
    ready: true,
  });
});

test('a review comment from a person does not count', async () => {
  const quoted = JSON.stringify({ body: '## Agent review\n\nBlocking findings: 0', login: 'jane' });
  const gh = fake([
    ['gh pr view 7', view([check('validate', 'SUCCESS'), check('agent-review', 'SUCCESS')])],
    rules,
    ['gh api --paginate repos/{owner}/{repo}/issues/7/comments', { out: quoted }],
  ]);
  expect(await prStatus(gh.run, '7')).toMatchObject({
    agentReview: { posted: false },
    ready: false,
  });
});

test('a required check that has not started is pending, so the PR is not ready', async () => {
  const gh = fake([['gh pr view 7', view([check('agent-review', 'SUCCESS')])], rules, comments()]);
  const status = await prStatus(gh.run, '7');
  expect(status.required[0]).toMatchObject({ name: 'validate', state: 'pending' });
  expect(status).toMatchObject({ counts: { pending: 1 }, dryRun: null, ready: false });
});

test('wait polls until no check is pending, and stops at the timeout', async () => {
  const pending = view([check('validate', '', 'IN_PROGRESS'), check('agent-review', 'SUCCESS')]);
  const done = view([check('validate', 'FAILURE'), check('agent-review', 'SUCCESS')]);
  const gh = fake([['gh pr view 7', [pending, pending, done]], rules, comments()]);
  const clock = fakeClock();
  expect(await runPr(['wait', '7', '--json'], gh.run, noWrite, clock)).toBe(1);
  expect(clock.slept).toBe(40_000);

  const stuck = fake([['gh pr view 7', pending], rules, comments()]);
  expect(await runPr(['wait', '7', '--timeout', '60s'], stuck.run, noWrite, fakeClock())).toBe(2);
});

const nxLog = [
  '2026-10-30T18:42:59.5Z ##[group]Run bun run validate',
  '2026-10-30T18:43:00.0Z \u001B[32m✔\u001B[39m  nx run clutch:lint',
  '2026-10-30T18:43:10.3Z ##[group]❌ > nx run clutch:check-changeset',
  '2026-10-30T18:43:10.3Z ',
  '2026-10-30T18:43:10.3Z Changeset check failed.',
  '2026-10-30T18:43:10.4Z ##[endgroup]',
  '2026-10-30T18:43:49.2Z Failed tasks:',
  '2026-10-30T18:43:49.2Z ',
  '2026-10-30T18:43:49.2Z - clutch:check-changeset',
  '2026-10-30T18:43:49.2Z ',
  '2026-10-30T18:43:49.2Z  full log: /home/runner/.nx/cache/terminalOutputs/123',
  '2026-10-30T18:43:49.3Z ##[error]Process completed with exit code 130.',
  '2026-10-30T18:43:50.0Z Post job cleanup.',
].join('\n');

test('a job log names the failed step and each failed Nx task with its own output', () => {
  const read = readJobLog(nxLog);
  expect(read.step).toBe('bun run validate');
  expect(read.tasks).toEqual([
    { name: 'clutch:check-changeset', output: 'Changeset check failed.' },
  ]);
  expect(read.tail).toContain('##[error]Process completed with exit code 130.');
  expect(read.tail).not.toContain('\u001B[');
  expect(read.tail).not.toContain('Post job cleanup');
});

test('failures reads the log of each failed job only', async () => {
  const gh = fake([
    ['gh pr view 7', view([check('validate', 'FAILURE'), check('agent-review', 'SUCCESS')])],
    rules,
    comments(),
    ['gh api repos/{owner}/{repo}/actions/jobs/8/logs', { out: nxLog }],
  ]);
  const logged: Array<string> = [];
  const original = console.log;
  console.log = (text: string) => logged.push(text);
  try {
    expect(await runPr(['failures', '7'], gh.run, noWrite)).toBe(0);
  } finally {
    console.log = original;
  }
  expect(gh.calls.filter((call) => call.includes('/logs'))).toEqual([
    'gh api repos/{owner}/{repo}/actions/jobs/8/logs --allow-escape-sequences',
  ]);
  expect(logged.join('\n')).toContain(
    '-- Nx task clutch:check-changeset failed:\nChangeset check failed.',
  );
});

const trunk: [string, Partial<Result>] = ['gh repo view', { out: 'main\n' }];
const release = (status: string, conclusion: string) => ({
  out: JSON.stringify([
    { headSha: 'm3rge', status, conclusion, url: 'https://github.com/o/r/actions/runs/9' },
  ]),
});

test('merge falls back to the stack when GitHub refuses a plain merge for its stack', async () => {
  const gh = fake([
    trunk,
    ['gh pr view 12 --json mergeCommit', { out: 'm3rge' }],
    ['gh pr view 12', { out: '{"baseRefName":"main","headRefName":"cl-024"}' }],
    ['gh pr list --state open --base cl-024', { out: '[]' }],
    ['gh pr merge 12 --merge', { ok: false, err: 'GraphQL: Pull request is part of a stack' }],
    [
      'gh run list --workflow release.yml',
      [release('in_progress', ''), release('completed', 'success')],
    ],
    ['git show origin/main:package.json', { out: '{"version":"1.2.3"}' }],
  ]);
  const clock = fakeClock();
  expect(await runPr(['merge', '12'], gh.run, noWrite, clock)).toBe(0);
  expect(gh.calls).toContain('gh stack merge 12 --merge --yes');
  expect(gh.calls).toContain('git fetch --quiet --tags origin');
  expect(clock.slept).toBe(15_000);
});

test('merge reports a failed release, and a plain merge error that is not the stack', async () => {
  const failed = fake([
    trunk,
    ['gh pr view 12 --json mergeCommit', { out: 'm3rge' }],
    ['gh pr view 12', { out: '{"baseRefName":"main","headRefName":"cl-024"}' }],
    ['gh pr list --state open --base cl-024', { out: '[]' }],
    ['gh run list --workflow release.yml', release('completed', 'failure')],
  ]);
  expect(await runPr(['merge', '12'], failed.run, noWrite, fakeClock())).toBe(1);
  expect(failed.calls.some((call) => call.startsWith('gh stack'))).toBe(false);

  const refused = fake([
    trunk,
    ['gh pr view 12', { out: '{"baseRefName":"main","headRefName":"cl-024"}' }],
    ['gh pr list --state open --base cl-024', { out: '[]' }],
    ['gh pr merge 12 --merge', { ok: false, err: 'Pull request is not mergeable' }],
  ]);
  await expect(runPr(['merge', '12'], refused.run, noWrite, fakeClock())).rejects.toThrow(
    'not mergeable',
  );
});

test('ready marks the issue done through tools/clutch.ts, commits and pushes', async () => {
  const gh = fake([
    [
      'gh pr view 7',
      {
        out: JSON.stringify({
          number: 7,
          url: 'https://github.com/o/r/pull/7',
          title: 'feat: x (CL-117)',
          body: '',
          headRefName: 'clutch/cl-117-pr-lifecycle',
          baseRefName: 'main',
        }),
      },
    ],
    ['git branch --show-current', { out: 'clutch/cl-117-pr-lifecycle\n' }],
  ]);
  expect(await runPr(['ready', 'CL-117', '7'], gh.run, noWrite)).toBe(0);
  expect(gh.calls.slice(-5)).toEqual([
    'bun tools/clutch.ts issues set CL-117 done --pr https://github.com/o/r/pull/7',
    'bun tools/clutch.ts issues --write',
    'git add .clutch',
    'git commit --quiet --message chore(tracker): mark CL-117 done',
    'git push origin HEAD',
  ]);
});

const syncAnswers = (
  rebase: Array<Partial<Result>>,
  conflicted: Array<Partial<Result>>,
  extra: Array<[string, Partial<Result>]> = [],
) =>
  fake([
    ...extra,
    trunk,
    [
      'gh pr view 7',
      {
        out: JSON.stringify({
          number: 7,
          url: 'https://github.com/o/r/pull/7',
          title: 'feat: x (CL-117)',
          body: 'Body',
          headRefName: 'clutch/cl-117-pr-lifecycle',
          baseRefName: 'main',
        }),
      },
    ],
    [
      'gh pr list --state open --head clutch/cl-117-pr-lifecycle',
      {
        out: '[{"number":7,"baseRefName":"main","url":"https://github.com/o/r/pull/7","isDraft":false}]',
      },
    ],
    ['git branch --show-current', { out: 'clutch/cl-117-pr-lifecycle\n' }],
    ['git rebase origin/main', rebase],
    ['git -c core.editor=true rebase --continue', { ok: true }],
    ['git diff --name-only --diff-filter=U', conflicted],
    ['git diff --name-only --diff-filter=A', { out: '.changeset/x.md' }],
  ]);

test('sync regenerates a conflicted tracker, validates and pushes with a lease', async () => {
  const gh = syncAnswers([{ ok: false, err: 'CONFLICT' }], [{ out: '.clutch/TRACKER.md\n' }]);
  const logged: Array<string> = [];
  const original = console.log;
  console.log = (text: string) => logged.push(text);
  try {
    expect(await runPr(['sync', '7'], gh.run, noWrite)).toBe(0);
  } finally {
    console.log = original;
  }
  const order = [
    'git fetch --prune origin',
    'git rebase origin/main',
    'bun tools/clutch.ts issues --write',
    'git add .clutch/TRACKER.md',
    'git -c core.editor=true rebase --continue',
    'bun run validate',
    'git push --set-upstream --force-with-lease origin HEAD',
  ];
  const positions = order.map((call) => gh.calls.indexOf(call));
  expect(positions.every((position) => position !== -1)).toBe(true);
  expect(positions).toEqual(positions.toSorted((a, b) => a - b));
  expect(logged).toContain('https://github.com/o/r/pull/7');
});

test('sync stops on a conflict outside the tracker', async () => {
  const gh = syncAnswers(
    [{ ok: false, err: 'CONFLICT' }],
    [{ out: '.clutch/TRACKER.md\ntools/github/pr.ts\n' }],
  );
  await expect(runPr(['sync', '7'], gh.run, noWrite)).rejects.toThrow(
    'The rebase stopped on tools/github/pr.ts.',
  );
  expect(gh.calls).not.toContain('bun run validate');
});

const releaseLookup = (err: string) =>
  fake([
    trunk,
    ['gh pr view 12 --json mergeCommit', { out: 'm3rge' }],
    ['gh pr view 12', { out: '{"baseRefName":"main","headRefName":"cl-024"}' }],
    ['gh pr list --state open --base cl-024', { out: '[]' }],
    ['gh run list --workflow release.yml', { ok: false, err }],
  ]);

test('merge passes without release.yml, and fails when it cannot read the release runs', async () => {
  const missing = releaseLookup('HTTP 404: workflow release.yml not found on the default branch');
  expect(await runPr(['merge', '12'], missing.run, noWrite, fakeClock())).toBe(0);
  const offline = releaseLookup('error connecting to api.github.com');
  expect(await runPr(['merge', '12'], offline.run, noWrite, fakeClock())).toBe(1);
});

test('sync replays only its own commits when the stack base moved under it', async () => {
  const gh = syncAnswers(
    [{ ok: true }],
    [{ out: '' }],
    [
      ['git config --get branch.clutch/cl-117-pr-lifecycle.clutchForkPoint', { out: 'old1234\n' }],
      ['git merge-base --is-ancestor old1234 origin/main', { ok: false }],
      ['git merge-base HEAD origin/main', { out: 'new5678\n' }],
    ],
  );
  const original = console.log;
  console.log = () => {};
  try {
    expect(await runPr(['sync', '7'], gh.run, noWrite)).toBe(0);
  } finally {
    console.log = original;
  }
  expect(gh.calls).toContain('git rebase --onto origin/main old1234');
  expect(gh.calls).not.toContain('git rebase origin/main');
  expect(gh.calls).toContain(
    'git config branch.clutch/cl-117-pr-lifecycle.clutchForkPoint new5678',
  );
});

test('failures reports a job log that GitHub no longer has', async () => {
  const gh = fake([
    ['gh pr view 7', view([check('validate', 'CANCELLED'), check('agent-review', 'SUCCESS')])],
    rules,
    comments(),
    ['gh api repos/{owner}/{repo}/actions/jobs/8/logs', { ok: false, err: 'gh: HTTP 404' }],
  ]);
  const logged: Array<string> = [];
  const original = console.log;
  console.log = (text: string) => logged.push(text);
  try {
    expect(await runPr(['failures', '7'], gh.run, noWrite)).toBe(0);
  } finally {
    console.log = original;
  }
  expect(logged.join('\n')).toContain('The log is not available: gh: HTTP 404');
});
