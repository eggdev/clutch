import { expect, test } from 'bun:test';

import { metricsReport, renderMetrics, renderVerdicts, verdictReport } from '@/metrics/report';
import { fakeGh, now, person, pullRoutes, repo, routes } from '@/testing/metrics-routes';

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
    watch: {
      noHumanBelowTarget: true,
      revertsOverLimit: true,
      mainRedMinutes: 75,
      tighten: [{ number: 7, title: 'Tighten risk? #2 was reverted', url: 'u7' }],
    },
  });
  expect(Object.keys(report.unavailable)).toEqual([]);
  expect(renderMetrics(report)).toContain(
    'no human action 50%, under the 80% target; reverts 50%, over the 2% limit; main red 75 min; tighten #7',
  );
  expect(renderMetrics(report)).toContain('Main red');
  expect(renderMetrics(report)).toContain('1 agreed, 0 disagreed, 1 unanswered of 2; streak 1');
});

test('a drill revert is merged but counts apart from the reverts, on the PRs and on main', async () => {
  const withDrill = {
    ...routes,
    'search/issues': { items: [{ number: 1 }, { number: 2 }, { number: 3 }] },
    ...pullRoutes(3, {
      mergedBy: person,
      title: 'Revert "feat: x"',
      trailer: '',
      ref: 'revert/3',
      author: person,
      labels: ['drill'],
      files: [['src/x.ts', 1, 1]],
    }),
    [`repos/${repo}/commits`]: [
      { sha: 'm3', parents: [{ sha: 'm2' }], commit: { message: 'Revert "feat: x"' } },
      ...(routes[`repos/${repo}/commits`] as Array<object>),
    ],
    [`repos/${repo}/commits/m3/check-runs`]: {
      check_runs: [
        {
          name: 'validate',
          status: 'completed',
          conclusion: 'success',
          completed_at: '2026-10-10T03:30:00Z',
        },
      ],
    },
  };
  const { gh } = fakeGh(withDrill);
  const report = await metricsReport({ gh, repo, days: 14, now });
  expect(report).toMatchObject({
    pulls: { merged: 3 },
    reverts: { pulls: 1, commits: 1, rate: 0.333, drills: 1 },
  });
  expect(renderMetrics(report)).toContain('1 PRs (33.3%), 1 commits on main; 1 drill');
});

test('another repository has no issues count, and an unreadable section names its reason', async () => {
  const {
    [`repos/${repo}/actions/runs`]: _runs,
    [`repos/${repo}/actions/workflows/agent-review.yml/runs`]: _reviews,
    ...rest
  } = routes;
  const { gh } = fakeGh(rest);
  const report = await metricsReport({ gh, repo, days: 14, now });
  expect(report.issuesDone).toBeNull();
  expect(report.ci).toBeNull();
  expect(report.unavailable.ci).toContain('HTTP 404');
  // With no agent review workflow, only submitted reviews count as a first review.
  expect(report.unavailable.agentReview).toContain('HTTP 404');
  expect(report.factory.cycleTimeHours.toFirstReview.count).toBe(0);
  expect(report.unavailable.issuesDone).toContain('.clutch/issues');
});

/** The comments with the grading bot's reply on a calibration issue. */
const withGrader = [
  ...(routes[`repos/${repo}/issues/comments`] as Array<object>),
  {
    body: "Graded on the owner's instruction: 👍 on 0 verdicts, 👎 on 1.\n\n<!-- grader:release-app[bot] -->",
    created_at: '2026-10-10T02:00:00Z',
    issue_url: `https://api.github.com/repos/${repo}/issues/40`,
    user: { login: 'github-actions[bot]', type: 'Bot' },
  },
];

test('the verdict report lists the ungraded verdicts with their reasons, and a bot grade counts', async () => {
  const { gh } = fakeGh({
    ...routes,
    [`repos/${repo}/issues/comments`]: withGrader,
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

test('only the bot that posted the grading reply grades, not any other bot', async () => {
  const { gh } = fakeGh({
    ...routes,
    [`repos/${repo}/issues/comments`]: withGrader,
    [`repos/${repo}/issues/comments/12/reactions`]: [
      { content: '-1', user: { login: 'other-app[bot]', type: 'Bot' } },
    ],
  });
  const report = await verdictReport({ gh, repo, days: 14, now, owner: 'jane' });
  expect(report.disagreed).toEqual([]);
  expect(report.ungraded.map((item) => item.pull)).toEqual([2]);
});

test("a grader marker in a person's comment names no grader", async () => {
  const forged = [
    ...(routes[`repos/${repo}/issues/comments`] as Array<object>),
    {
      body: "Graded on the owner's instruction: 👍 on 1 verdicts, 👎 on 0.\n\n<!-- grader:other-app[bot] -->",
      created_at: '2026-10-10T02:00:00Z',
      issue_url: `https://api.github.com/repos/${repo}/issues/40`,
      user: { login: 'visitor', type: 'User' },
    },
  ];
  const { gh } = fakeGh({
    ...routes,
    [`repos/${repo}/issues/comments`]: forged,
    [`repos/${repo}/issues/comments/12/reactions`]: [
      { content: '+1', user: { login: 'other-app[bot]', type: 'Bot' } },
    ],
  });
  const report = await verdictReport({ gh, repo, days: 14, now, owner: 'jane' });
  expect(report.ungraded.map((item) => item.pull)).toEqual([2]);
});

test('with no owner, no reaction is a grade, and the report says why', async () => {
  const { gh } = fakeGh(routes);
  const verdicts = await verdictReport({ gh, repo, days: 14, now, owner: null });
  expect(verdicts.ungraded.map((item) => item.pull)).toEqual([1, 2]);
  expect(verdicts.agreement).toMatchObject({ agreed: 0, streak: 0 });
  const report = await metricsReport({ gh, repo, days: 14, now, owner: null });
  expect(report.unavailable.verdictOwner).toContain('no reaction counts as a grade');
});

test('the factory numbers lead the report, from reviews, agent review and the in_progress commit', async () => {
  const issueCommits = `repos/${repo}/commits?path=${encodeURIComponent('.clutch/issues/CL-001.md')}&until=${encodeURIComponent('2026-10-09T22:00:00Z')}`;
  const { gh } = fakeGh({
    ...routes,
    // CL-001 went in_progress 10 hours before its branch's first commit.
    [issueCommits]: [
      {
        sha: 'i1',
        parents: [{ sha: 'm0' }],
        author: person,
        commit: {
          message: 'chore(tracker): start CL-001',
          author: { date: '2026-10-09T12:00:00Z' },
        },
      },
    ],
    [`repos/${repo}/commits/i1`]: {
      files: [
        { filename: '.clutch/issues/CL-001.md', patch: '-status: todo\n+status: in_progress' },
      ],
    },
    // A person reviewed PR 2 ten minutes before agent review finished.
    [`repos/${repo}/issues/2/timeline`]: [
      { event: 'reviewed', state: 'approved', user: person, submitted_at: '2026-10-10T00:10:00Z' },
      { event: 'merged', actor: person },
    ],
  });
  const report = await metricsReport({ gh, repo, days: 14, now });
  expect(report.factory).toMatchObject({
    definitions: 'warp-2026-11-04',
    merged: 2,
    // Renovate's PR has only a bot's commit, and a review by a person is not a push.
    autonomy: { autonomous: 2, merged: 2, share: 1, humanPushed: [] },
    cycleTimeHours: {
      toPr: { p50: 7, p90: 11, count: 2 },
      toFirstReview: { count: 2 },
      toMerge: { p50: 8.5, p90: 12.1, count: 2 },
    },
    // PR 2 is `Revert "feat: add x"`, so it reverts PR 1.
    reverts: { reverted: 1, merged: 2, rate: 0.5, overBrake: true, pulls: [1] },
  });
  expect(report.factory.cycleTimeHours.toFirstReview.p90).toBe(11.3);
  const text = renderMetrics(report);
  expect(text.indexOf('Autonomy')).toBeLessThan(text.indexOf('Merged PRs'));
  expect(text).toContain('100% (2 of 2 PRs with no human code push)');
  expect(text).toContain('50% (1 of 2: #1), brake 2%');
});
