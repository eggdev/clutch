import { expect, test } from 'bun:test';

import type { Config } from '@tools/github/auto-merge-rules';
import type { Mode } from '@tools/github/auto-merge-sweep';
import { stalePrs, sweep, sweepCap } from '@tools/github/auto-merge-sweep';
import { fake } from '@tools/github/fake-run';
import type { Result, Run } from '@tools/github/stack';

const repo = 'eggdev/clutch';
const agent = { login: 'eggdev', is_bot: false };
const bot = { login: 'app/renovate', is_bot: true };

/** When the last required check of every green head finished. */
const DONE = '2026-11-02T09:00:00Z';

type Listed = {
  number: number;
  state: string;
  isDraft: boolean;
  isCrossRepository: boolean;
  baseRefName: string;
  headRefName: string;
  headRefOid: string;
  author: { login: string; is_bot: boolean };
};

/** An open, ready, same-repository agent PR into main, at head `sha<number>`. */
const pr = (number: number, fields: Partial<Listed> = {}): Listed => ({
  number,
  state: 'OPEN',
  isDraft: false,
  isCrossRepository: false,
  baseRefName: 'main',
  headRefName: `clutch/cl-${number}-x`,
  headRefOid: `sha${number}`,
  author: agent,
  ...fields,
});

type Judged = {
  databaseId: number;
  conclusion: string | null;
  createdAt: string;
  displayTitle: string;
  event: string;
  headSha: string;
  status: string;
};

/** A run of the Auto-merge workflow on head sha7, completed as a success, from a pull_request event. */
const judged = (fields: Partial<Judged>): Judged => ({
  databaseId: 70,
  conclusion: 'success',
  createdAt: '2026-11-02T10:00:00Z',
  displayTitle: 'Auto-merge',
  event: 'pull_request',
  headSha: 'sha7',
  status: 'completed',
  ...fields,
});

/** The check runs of a head: validate and agent review, both finished at DONE, or validate still running. */
const checkRuns = (green: boolean) =>
  [
    {
      id: 1,
      name: 'validate',
      status: green ? 'completed' : 'in_progress',
      conclusion: green ? 'success' : null,
      completed_at: green ? DONE : null,
      app: 'github-actions',
    },
    {
      id: 2,
      name: 'agent-review',
      status: 'completed',
      conclusion: 'success',
      completed_at: DONE,
      app: 'github-actions',
    },
  ]
    .map((line) => JSON.stringify(line))
    .join('\n');

/**
 * A fake repository: the open PRs, their green checks unless `pending` names a
 * head, the Auto-merge runs, and each run's decide job as `[conclusion, startedAt]`.
 */
function world(
  prs: Array<Listed>,
  options: {
    runs?: Array<Judged>;
    decides?: Record<number, [string | null, string]>;
    pending?: Array<string>;
  } = {},
) {
  const { runs = [], decides = {}, pending = [] } = options;
  const answers: Array<[string, Partial<Result>]> = [
    ['gh repo view --json nameWithOwner', { out: `${repo}\n` }],
    ['gh repo view --json defaultBranchRef', { out: 'main\n' }],
    ['gh pr list', { out: JSON.stringify(prs) }],
    ['gh run list', { out: JSON.stringify(runs) }],
    [`gh api repos/${repo}/rules/branches/main`, { out: '["validate"]' }],
    ...pending.map((sha): [string, Partial<Result>] => [
      `gh api --paginate repos/${repo}/commits/${sha}/check-runs`,
      { out: checkRuns(false) },
    ]),
    ...prs.map((item): [string, Partial<Result>] => [
      `gh api --paginate repos/${repo}/commits/${item.headRefOid}/check-runs`,
      { out: checkRuns(true) },
    ]),
    ...Object.entries(decides).map(([id, [conclusion, startedAt]]): [string, Partial<Result>] => [
      `gh api --paginate repos/${repo}/actions/runs/${id}/jobs`,
      { out: `${conclusion ?? ''}\t${startedAt}` },
    ]),
  ];
  return fake(answers);
}

const chosen = (run: Run, mode: Mode) => stalePrs(run, repo, 'main', mode);

/** A decide that started after the last check finished, and succeeded. */
const heldDecide: [string, string] = ['success', '2026-11-02T10:00:30Z'];

test('a held PR, decided after its checks finished, is left alone hourly, and a push dispatches it', async () => {
  const gh = world([pr(7)], { runs: [judged({ databaseId: 70 })], decides: { 70: heldDecide } });
  expect(await chosen(gh.run, 'schedule')).toEqual([]);
  expect(await chosen(gh.run, 'push')).toEqual([7]);
});

test('a decide job that was skipped did not decide, so the PR is chosen, even when its run succeeded', async () => {
  const gh = world([pr(7)], {
    runs: [judged({ databaseId: 70, conclusion: 'success' })],
    decides: { 70: ['skipped', '2026-11-02T10:00:30Z'] },
  });
  expect(await chosen(gh.run, 'schedule')).toEqual([7]);
});

test('a failed decide is chosen again', async () => {
  const gh = world([pr(7)], {
    runs: [judged({ databaseId: 70, conclusion: 'failure' })],
    decides: { 70: ['failure', '2026-11-02T10:00:30Z'] },
  });
  expect(await chosen(gh.run, 'schedule')).toEqual([7]);
});

test('a decide that started before the last check finished does not hold the PR', async () => {
  const gh = world([pr(7)], {
    runs: [judged({ databaseId: 70, createdAt: '2026-11-02T08:30:00Z' })],
    decides: { 70: ['success', '2026-11-02T08:30:30Z'] },
  });
  expect(await chosen(gh.run, 'schedule')).toEqual([7]);
});

test('a later decide failure overrides an earlier success', async () => {
  const gh = world([pr(7)], {
    runs: [
      judged({ databaseId: 70, createdAt: '2026-11-02T10:00:00Z' }),
      judged({ databaseId: 71, createdAt: '2026-11-02T11:00:00Z', conclusion: 'failure' }),
    ],
    decides: { 70: heldDecide, 71: ['failure', '2026-11-02T11:00:30Z'] },
  });
  expect(await chosen(gh.run, 'schedule')).toEqual([7]);
});

test('a dispatch decide counts for its PR, by the title of its run', async () => {
  const gh = world([pr(7)], {
    runs: [
      judged({
        databaseId: 80,
        displayTitle: 'Auto-merge #7',
        event: 'workflow_dispatch',
        headSha: 'mainsha',
      }),
    ],
    decides: { 80: heldDecide },
  });
  expect(await chosen(gh.run, 'schedule')).toEqual([]);
});

test('a decide still going skips the PR hourly, but a push dispatches it anyway', async () => {
  const gh = world([pr(7)], { runs: [judged({ status: 'in_progress', conclusion: null })] });
  expect(await chosen(gh.run, 'schedule')).toEqual([]);
  expect(await chosen(gh.run, 'push')).toEqual([7]);
});

test('a PR with a required check still running is skipped in both modes', async () => {
  const gh = world([pr(7)], { pending: ['sha7'] });
  expect(await chosen(gh.run, 'schedule')).toEqual([]);
  expect(await chosen(gh.run, 'push')).toEqual([]);
});

test('a draft, a fork, a stacked PR and a person’s PR are never eligible, and a bot PR is', async () => {
  const gh = world([
    pr(1, { isDraft: true }),
    pr(2, { isCrossRepository: true }),
    pr(3, { baseRefName: 'clutch/cl-2-x' }),
    pr(4, { headRefName: 'feature/x', author: agent }),
    pr(5),
    pr(6, { headRefName: 'renovate/all-minor', author: bot }),
  ]);
  expect(await chosen(gh.run, 'push')).toEqual([5, 6]);
  const pending = world(
    [
      pr(1, { isDraft: true }),
      pr(2, { isCrossRepository: true }),
      pr(3, { baseRefName: 'clutch/cl-2-x' }),
      pr(4, { headRefName: 'feature/x', author: agent }),
      pr(5),
      pr(6, { headRefName: 'renovate/all-minor', author: bot }),
    ],
    { pending: ['sha5'] },
  );
  expect(await chosen(pending.run, 'push')).toEqual([6]);
});

test('a push chooses every eligible PR, held ones too, least recently decided first', async () => {
  const gh = world([pr(7), pr(8), pr(9)], {
    runs: [judged({ databaseId: 70 })],
    decides: { 70: heldDecide },
    pending: ['sha9'],
  });
  expect(await chosen(gh.run, 'push')).toEqual([8, 7]);
  expect(await chosen(gh.run, 'schedule')).toEqual([8]);
});

test('at most 20 PRs in both modes, the least recently decided first', async () => {
  expect(sweepCap).toBe(20);
  const prs = Array.from({ length: 25 }, (_, index) => pr(index + 1));
  // PR n's run was created n hours before the day's start, so the highest numbers are the oldest.
  const runs = prs.map((item) =>
    judged({
      databaseId: 100 + item.number,
      headSha: item.headRefOid,
      createdAt: new Date(Date.UTC(2026, 10, 2) - item.number * 3_600_000).toISOString(),
      conclusion: 'failure',
    }),
  );
  const decides = Object.fromEntries(
    prs.map((item) => [100 + item.number, ['failure', DONE] as [string, string]]),
  );
  const gh = world(prs, { runs, decides });
  const twenty = Array.from({ length: 20 }, (_, index) => 25 - index);
  expect(await chosen(gh.run, 'schedule')).toEqual(twenty);
  expect(await chosen(gh.run, 'push')).toEqual(twenty);
});

test('the sweep dispatches each chosen PR, and nothing while auto-merge is off', async () => {
  const on: Config = { mode: 'on', step: 'medium' };
  const gh = world([pr(7)]);
  const lines: Array<string> = [];
  expect(await sweep(gh.run, on, 'push', (line) => lines.push(line))).toEqual([7]);
  expect(gh.calls).toContain('gh workflow run auto-merge.yml -f pr=7');
  expect(lines).toEqual(['Dispatched the decision for #7.']);

  const held = world([pr(7)], { runs: [judged({ databaseId: 70 })], decides: { 70: heldDecide } });
  expect(await sweep(held.run, on, 'schedule', () => {})).toEqual([]);
  expect(held.calls.some((call) => call.startsWith('gh workflow run'))).toBe(false);

  const off = world([pr(7)]);
  expect(await sweep(off.run, { mode: 'off', step: 'medium' }, 'push', () => {})).toEqual([]);
  expect(off.calls.some((call) => call.startsWith('gh workflow run'))).toBe(false);
});
