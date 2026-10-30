import { expect, test } from 'bun:test';

import type { Gh } from '@/doctor/remote';
import { metricsReport, renderMetrics } from '@/metrics/report';

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

const pullRoutes = (number: number, mergedBy: object, title: string, trailer: string) => ({
  [`repos/${repo}/pulls/${number}/commits`]: [{ commit: { message: `${title}\n\n${trailer}` } }],
  [`repos/${repo}/pulls/${number}`]: {
    title,
    created_at: '2026-10-10T00:00:00Z',
    merged_at: `2026-10-10T0${number}:00:00Z`,
    merged_by: mergedBy,
    head: { sha: `head${number}` },
  },
  [`repos/${repo}/issues/${number}/timeline`]: [{ event: 'merged', actor: mergedBy }],
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
  ...pullRoutes(1, bot, 'feat: add x', 'Co-authored-by: Claude <noreply@anthropic.com>'),
  ...pullRoutes(2, person, 'Revert "feat: add x"', ''),
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
};

test('the report reads only gh api GET routes and fills every field', async () => {
  const { gh, calls } = fakeGh(routes);
  const issues = [
    { status: 'done', pr: `https://github.com/${repo}/pull/1` },
    { status: 'done', pr: 'https://github.com/acme/other/pull/1' },
  ];
  const report = await metricsReport({ gh, repo, days: 14, now, issues });
  for (const call of calls) {
    expect(call[0]).toBe('api');
  }
  expect(report).toMatchObject({
    schemaVersion: 1,
    repo,
    pulls: {
      merged: 2,
      noHumanAction: { count: 1, share: 0.5 },
      agents: { pullShare: 0.5, byAgent: { claude: 1 } },
    },
    reverts: { pulls: 1, commits: 1, rate: 0.5 },
    mainRed: { branch: 'main', requiredChecks: ['validate'], minutes: 75 },
    ci: { runs: 1, failureRate: 0 },
    issuesDone: 1,
    prSize: null,
    dryRunAgreement: null,
  });
  expect(Object.keys(report.unavailable).toSorted()).toEqual(['dryRunAgreement', 'prSize']);
  expect(renderMetrics(report)).toContain('Main red');
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
