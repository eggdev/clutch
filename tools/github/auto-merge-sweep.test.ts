import { expect, test } from 'bun:test';

import { enabledMarker, marker } from '@tools/github/auto-merge-rules';
import type { Config } from '@tools/github/auto-merge-rules';
import { sweepCap, stalePrs, sweep } from '@tools/github/auto-merge-sweep';
import { fake } from '@tools/github/fake-run';
import type { Result } from '@tools/github/stack';

const repo = 'eggdev/clutch';
const agent = { login: 'eggdev', is_bot: false };
const bot = { login: 'app/renovate', is_bot: true };

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
  conclusion: string | null;
  createdAt: string;
  displayTitle: string;
  event: string;
  headSha: string;
  status: string;
};

/** A run of the Auto-merge workflow, completed as a success by default. */
const judged = (fields: Partial<Judged>): Judged => ({
  conclusion: 'success',
  createdAt: '2026-11-02T10:00:00Z',
  displayTitle: 'Auto-merge',
  event: 'pull_request',
  headSha: 'sha7',
  status: 'completed',
  ...fields,
});

/** The check runs of a head: validate and agent review, both green or validate still running. */
const checkRuns = (green: boolean) =>
  [
    {
      id: 1,
      name: 'validate',
      status: green ? 'completed' : 'in_progress',
      conclusion: green ? 'success' : null,
      app: 'github-actions',
    },
    {
      id: 2,
      name: 'agent-review',
      status: 'completed',
      conclusion: 'success',
      app: 'github-actions',
    },
  ]
    .map((line) => JSON.stringify(line))
    .join('\n');

/**
 * A fake repository: the open PRs, their green checks unless `pending` names a
 * head, the Auto-merge runs, and each PR's comment bodies.
 */
function world(
  prs: Array<Listed>,
  options: {
    runs?: Array<Judged>;
    comments?: Record<number, string>;
    pending?: Array<string>;
  } = {},
) {
  const { runs = [], comments = {}, pending = [] } = options;
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
    ...Object.entries(comments).map(([number, body]): [string, Partial<Result>] => [
      `gh api --paginate repos/${repo}/issues/${number}/comments`,
      { out: body },
    ]),
  ];
  return fake(answers);
}

const chosen = (run: Parameters<typeof stalePrs>[0]) => stalePrs(run, repo, 'main');

test('a green agent PR with no verdict for its head is chosen', async () => {
  expect(await chosen(world([pr(7)]).run)).toEqual([7]);
});

test('a bot PR is chosen, and a PR that is not judged, or not ready, is not', async () => {
  const gh = world(
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
  expect(await chosen(gh.run)).toEqual([6]);
});

test('a verdict for the head stops the sweep, and a verdict for an older head does not', async () => {
  const gh = world([pr(7), pr(8), pr(9)], {
    comments: {
      7: `Auto-merge dry run.\n${marker('sha7')}`,
      8: marker('old8'),
      9: enabledMarker('low', 'sha9'),
    },
  });
  expect(await chosen(gh.run)).toEqual([8]);
});

test('a PR whose last decide run failed is chosen again, even with a verdict', async () => {
  const gh = world([pr(7)], {
    comments: { 7: marker('sha7') },
    runs: [judged({ conclusion: 'failure' })],
  });
  expect(await chosen(gh.run)).toEqual([7]);
});

test('a decide run still going skips the PR, and a dispatch run counts for its PR', async () => {
  const going = world([pr(7)], { runs: [judged({ status: 'in_progress', conclusion: null })] });
  expect(await chosen(going.run)).toEqual([]);
  const failedDispatch = world([pr(7)], {
    comments: { 7: marker('sha7') },
    runs: [
      judged({
        displayTitle: 'Auto-merge #7',
        event: 'workflow_dispatch',
        headSha: 'mainsha',
        conclusion: 'failure',
      }),
    ],
  });
  expect(await chosen(failedDispatch.run)).toEqual([7]);
  const dispatchedGreen = world([pr(7)], {
    comments: { 7: marker('sha7') },
    runs: [
      judged({
        displayTitle: 'Auto-merge #7',
        event: 'workflow_dispatch',
        headSha: 'mainsha',
      }),
    ],
  });
  expect(await chosen(dispatchedGreen.run)).toEqual([]);
});

test('at most 20 PRs, the least recently decided first', async () => {
  expect(sweepCap).toBe(20);
  const prs = Array.from({ length: 25 }, (_, index) => pr(index + 1));
  // PR n was decided (n) hours before the day's start, so the highest numbers are the oldest.
  const runs = prs.map((item) =>
    judged({
      headSha: item.headRefOid,
      createdAt: new Date(Date.UTC(2026, 10, 2) - item.number * 3_600_000).toISOString(),
    }),
  );
  const gh = world(prs, { runs });
  expect(await chosen(gh.run)).toEqual(Array.from({ length: 20 }, (_, index) => 25 - index));
});

test('the sweep dispatches the workflow for each stale PR, and nothing while auto-merge is off', async () => {
  const on: Config = { mode: 'on', step: 'medium' };
  const gh = world([pr(7)]);
  const lines: Array<string> = [];
  expect(await sweep(gh.run, on, (line) => lines.push(line))).toEqual([7]);
  expect(gh.calls).toContain('gh workflow run auto-merge.yml -f pr=7');
  expect(lines).toEqual(['Dispatched the decision for #7.']);

  const off = world([pr(7)]);
  expect(await sweep(off.run, { mode: 'off', step: 'medium' }, () => {})).toEqual([]);
  expect(off.calls.some((call) => call.startsWith('gh workflow run'))).toBe(false);
});
