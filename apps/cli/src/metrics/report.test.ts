import { expect, test } from 'bun:test';

import type { Gh } from '@/doctor/remote';
import { metricsReport, renderMetrics, renderVerdicts, verdictReport } from '@/metrics/report';

const repo = 'acme/shop';
const now = new Date('2026-10-15T00:00:00Z');
const bot = { login: 'release-app[bot]', type: 'Bot' };
const person = { login: 'jane', type: 'User' };

/**
 * A fake `gh` that answers GET routes from `routes`, by path without the
 * query. Any write fails.
 */
function fakeGh(routes: Record<string, unknown>) {
  const calls: Array<Array<string>> = [];
  const gh: Gh = (args) => {
    calls.push(args);
    const [route = ''] = (args.at(-1) ?? '').split('?');
    const answer = routes[route];
    if (args.some((arg) => ['-X', '--method', '-f', '-F', '--input'].includes(arg))) {
      return Promise.resolve({ ok: false, out: '', err: 'writes are not allowed' });
    }
    if (answer === undefined) {
      return Promise.resolve({ ok: false, out: '', err: 'gh: Not Found (HTTP 404)' });
    }
    return Promise.resolve({ ok: true, out: JSON.stringify(answer), err: '' });
  };
  return { gh, calls };
}

type Shape = {
  mergedBy: object;
  title: string;
  trailer: string;
  ref: string;
  author: object;
  labels: Array<string>;
  files: Array<[string, number, number]>;
  comments?: Array<string>;
};

const pullRoutes = (number: number, shape: Shape) => ({
  [`repos/${repo}/pulls/${number}/commits`]: [
    { commit: { message: `${shape.title}\n\n${shape.trailer}` } },
  ],
  [`repos/${repo}/pulls/${number}/files`]: shape.files.map(([filename, additions, deletions]) => ({
    filename,
    additions,
    deletions,
  })),
  [`repos/${repo}/pulls/${number}`]: {
    title: shape.title,
    created_at: '2026-10-10T00:00:00Z',
    merged_at: `2026-10-10T0${number}:00:00Z`,
    merged_by: shape.mergedBy,
    user: shape.author,
    labels: shape.labels.map((name) => ({ name })),
    head: { sha: `head${number}`, ref: shape.ref },
  },
  [`repos/${repo}/issues/${number}/timeline`]: [
    ...(shape.comments ?? []).map((body) => ({ event: 'commented', user: bot, body })),
    { event: 'merged', actor: shape.mergedBy },
  ],
  [`repos/${repo}/commits/head${number}/check-runs`]: {
    check_runs: [
      {
        name: 'validate',
        status: 'completed',
        conclusion: 'success',
        completed_at: '2026-10-10T00:30:00Z',
      },
    ],
  },
});

const routes = {
  'search/issues': { items: [{ number: 1 }, { number: 2 }] },
  // An agent PR that auto-merge merged at the low step, with a lockfile that does not count.
  ...pullRoutes(1, {
    mergedBy: bot,
    title: 'feat: add x',
    trailer: 'Co-authored-by: Claude <noreply@anthropic.com>',
    ref: 'clutch/cl-001-x',
    author: { login: 'jane', type: 'User' },
    labels: ['risk/low', 'kind/feat'],
    files: [
      ['src/x.ts', 100, 20],
      ['bun.lock', 4000, 1000],
    ],
    comments: ['<!-- automerge-enabled:low:abc1234 -->\nAuto-merge is on.'],
  }),
  // A Renovate PR that a person merged.
  ...pullRoutes(2, {
    mergedBy: person,
    title: 'Revert "feat: add x"',
    trailer: '',
    ref: 'renovate/x',
    author: { login: 'renovate[bot]', type: 'Bot' },
    labels: ['risk/medium'],
    files: [['src/x.ts', 20, 100]],
  }),
  [`repos/${repo}/rules/branches/main`]: [
    {
      type: 'required_status_checks',
      parameters: { required_status_checks: [{ context: 'validate' }] },
    },
  ],
  [`repos/${repo}/commits`]: [
    { sha: 'm2', parents: [{ sha: 'm1' }], commit: { message: 'Revert "feat: add x"' } },
    { sha: 'm1', parents: [{ sha: 'm0' }], commit: { message: 'feat: add x' } },
  ],
  [`repos/${repo}/commits/m0/check-runs`]: { check_runs: [] },
  [`repos/${repo}/commits/m1/check-runs`]: {
    check_runs: [
      {
        name: 'validate',
        status: 'completed',
        conclusion: 'failure',
        completed_at: '2026-10-10T01:00:00Z',
      },
    ],
  },
  [`repos/${repo}/commits/m2/check-runs`]: {
    check_runs: [
      {
        name: 'validate',
        status: 'completed',
        conclusion: 'success',
        completed_at: '2026-10-10T02:15:00Z',
      },
    ],
  },
  [`repos/${repo}/actions/runs`]: {
    workflow_runs: [
      {
        conclusion: 'success',
        run_started_at: '2026-10-10T00:00:00Z',
        updated_at: '2026-10-10T00:04:00Z',
      },
    ],
  },
  [`repos/${repo}`]: { default_branch: 'main' },
  [`repos/${repo}/issues/comments`]: [
    {
      id: 11,
      html_url: `https://github.com/${repo}/pull/1#issuecomment-11`,
      body: '<!-- automerge-dry-run:head1 -->\n**Auto-merge dry run:** this pull request would auto-merge at head1.',
      created_at: '2026-10-10T00:40:00Z',
      issue_url: `https://api.github.com/repos/${repo}/issues/1`,
      reactions: { '+1': 1, '-1': 0 },
    },
    {
      id: 12,
      html_url: `https://github.com/${repo}/pull/2#issuecomment-12`,
      body: '<!-- automerge-dry-run:head2 -->\n**Auto-merge dry run:** this pull request would not auto-merge at head2.\n\n- The risk tier is medium, not low.\n\nOwner: react 👍 if you agree with this verdict, or 👎 if not.',
      created_at: '2026-10-10T01:40:00Z',
      issue_url: `https://api.github.com/repos/${repo}/issues/2`,
      reactions: { '+1': 0, '-1': 0 },
    },
    { body: 'LGTM', created_at: '2026-10-10T01:50:00Z', issue_url: 'x/2', reactions: {} },
  ],
  // The owner's 👍 on the first verdict. A stranger's 👍 on the second does not count.
  [`repos/${repo}/issues/comments/11/reactions`]: [
    { content: '+1', user: { login: 'jane', type: 'User' } },
  ],
  [`repos/${repo}/issues/comments/12/reactions`]: [
    { content: '+1', user: { login: 'visitor', type: 'User' } },
  ],
};

test('the report reads only gh api GET routes and fills every field', async () => {
  const { gh, calls } = fakeGh(routes);
  const issues = [
    { status: 'done', pr: `https://github.com/${repo}/pull/1` },
    { status: 'done', pr: 'https://github.com/acme/other/pull/1' },
  ];
  const report = await metricsReport({ gh, repo, days: 14, now, issues, owner: 'jane' });
  for (const call of calls) {
    expect(call[0]).toBe('api');
  }
  expect(report).toMatchObject({
    schemaVersion: 1,
    repo,
    pulls: {
      merged: 2,
      noHumanAction: {
        count: 1,
        share: 0.5,
        byStep: { bots: 0, low: 1, medium: 0, unattributed: 0, marked: 1 },
      },
      agents: {
        pullShare: 0.5,
        byAgent: { claude: 1 },
        branch: { prefix: 'clutch/cl-', pulls: 1, share: 0.5 },
      },
    },
    reverts: { pulls: 1, commits: 1, rate: 0.5 },
    mainRed: { branch: 'main', requiredChecks: ['validate'], minutes: 75 },
    ci: { runs: 1, failureRate: 0 },
    issuesDone: 1,
    prSize: {
      lines: { p50: 120, p90: 120, count: 2 },
      labels: { 'size/S': 0, 'size/M': 2, 'size/L': 0, 'size/XL': 0 },
    },
    dryRunAgreement: { verdicts: 2, wouldMerge: 1, agreed: 1, unanswered: 1, streak: 1 },
  });
  expect(Object.keys(report.unavailable)).toEqual([]);
  expect(renderMetrics(report)).toContain('Main red');
  expect(renderMetrics(report)).toContain('1 agreed, 0 disagreed, 1 unanswered of 2; streak 1');
});

test('another repository has no issues count, and an unreadable section names its reason', async () => {
  const { [`repos/${repo}/actions/runs`]: _runs, ...rest } = routes;
  const { gh } = fakeGh(rest);
  const report = await metricsReport({ gh, repo, days: 14, now });
  expect(report.issuesDone).toBeNull();
  expect(report.ci).toBeNull();
  expect(report.unavailable.ci).toContain('HTTP 404');
  expect(report.unavailable.issuesDone).toContain('.clutch/issues');
});

test('the verdict report lists the ungraded verdicts with their reasons, and a bot grade counts', async () => {
  const { gh } = fakeGh({
    ...routes,
    [`repos/${repo}/issues/comments/12/reactions`]: [
      { content: '-1', user: { login: 'release-app[bot]', type: 'Bot' } },
    ],
  });
  const graded = await verdictReport({ gh, repo, days: 14, now, owner: 'jane' });
  expect(graded.ungraded).toEqual([]);
  expect(graded.disagreed).toEqual([
    {
      commentId: 12,
      pull: 2,
      url: `https://github.com/${repo}/pull/2#issuecomment-12`,
      createdAt: '2026-10-10T01:40:00Z',
      verdict: 'would not auto-merge',
      reasons: ['The risk tier is medium, not low.'],
    },
  ]);
  expect(graded.agreement).toMatchObject({ agreed: 1, disagreed: 1, streak: 0 });

  const open = await verdictReport({ gh: fakeGh(routes).gh, repo, days: 14, now, owner: 'jane' });
  expect(open.ungraded.map((item) => item.pull)).toEqual([2]);
  expect(renderVerdicts(open)).toContain(
    '#2  would not auto-merge: The risk tier is medium, not low.  https://github.com/acme/shop/pull/2#issuecomment-12',
  );
  expect(renderVerdicts(open)).toContain('graded by @jane. Streak: 1 agreed in a row.');
});
