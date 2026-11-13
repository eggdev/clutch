import type { Gh } from '@/doctor/remote';

/**
 * The GitHub answers for the `clutch metrics` report tests: a repository with
 * 2 merged pull requests, the checks of its default branch, a CI run, a
 * tighten issue and 2 dry-run verdicts.
 */
export const repo = 'acme/shop';
export const now = new Date('2026-10-15T00:00:00Z');
const bot = { login: 'release-app[bot]', type: 'Bot' };
export const person = { login: 'jane', type: 'User' };

/**
 * A fake `gh` that answers GET routes from `routes`: by path and query without
 * the paging, else by path alone. Any write fails.
 */
export function fakeGh(routes: Record<string, unknown>) {
  const calls: Array<Array<string>> = [];
  const gh: Gh = (args) => {
    calls.push(args);
    const [route = '', query = ''] = (args.at(-1) ?? '').split('?');
    const kept = query
      .split('&')
      .filter((part) => part && !/^(?:per_page|page)=/u.test(part))
      .join('&');
    const answer = (kept ? routes[`${route}?${kept}`] : undefined) ?? routes[route];
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
  author: { login: string; type: string };
  labels: Array<string>;
  files: Array<[string, number, number]>;
  comments?: Array<string>;
};

export const pullRoutes = (number: number, shape: Shape) => ({
  [`repos/${repo}/pulls/${number}/commits`]: [
    {
      sha: `c${number}`,
      parents: [{ sha: 'm0' }],
      author: shape.author,
      commit: {
        message: `${shape.title}\n\n${shape.trailer}`,
        author: { name: shape.author.login, date: '2026-10-09T22:00:00Z' },
      },
    },
  ],
  [`repos/${repo}/pulls/${number}/files`]: shape.files.map(([filename, additions, deletions]) => ({
    filename,
    additions,
    deletions,
  })),
  [`repos/${repo}/pulls/${number}`]: {
    title: shape.title,
    body: '',
    created_at: '2026-10-10T00:00:00Z',
    merged_at: `2026-10-10T0${number}:00:00Z`,
    merged_by: shape.mergedBy,
    user: shape.author,
    labels: shape.labels.map((name) => ({ name })),
    head: { sha: `head${number}`, ref: shape.ref },
    merge_commit_sha: `m${number}`,
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

export const routes = {
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
  // Agent review finished on each PR's only commit, 20 minutes after it opened. A cancelled run does not count.
  [`repos/${repo}/actions/workflows/agent-review.yml/runs`]: {
    workflow_runs: [
      {
        head_sha: 'c1',
        status: 'completed',
        conclusion: 'cancelled',
        updated_at: '2026-10-10T00:05:00Z',
      },
      {
        head_sha: 'c1',
        status: 'completed',
        conclusion: 'success',
        updated_at: '2026-10-10T00:20:00Z',
      },
      {
        head_sha: 'c2',
        status: 'completed',
        conclusion: 'failure',
        updated_at: '2026-10-10T00:20:00Z',
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
  // The CI workflow: one PR run in the period, which took 5 min, and one in the period before, which took 4 min.
  [`repos/${repo}/actions/workflows/ci.yml/runs`]: {
    workflow_runs: [
      {
        id: 901,
        event: 'pull_request',
        conclusion: 'success',
        created_at: '2026-10-10T00:00:00Z',
        run_started_at: '2026-10-10T00:00:00Z',
        updated_at: '2026-10-10T00:05:00Z',
      },
      {
        id: 900,
        event: 'pull_request',
        conclusion: 'success',
        created_at: '2026-09-25T00:00:00Z',
        run_started_at: '2026-09-25T00:00:00Z',
        updated_at: '2026-09-25T00:04:00Z',
      },
    ],
  },
  // Its validate step took 90 s, against 60 s in the period before: a rise of 50%.
  ...Object.fromEntries(
    [
      [901, '2026-10-10T00:01:00Z', '2026-10-10T00:02:30Z'],
      [900, '2026-09-25T00:01:00Z', '2026-09-25T00:02:00Z'],
    ].map(([id, started, completed], index) => [
      `repos/${repo}/actions/runs/${id}/jobs`,
      {
        jobs: [
          {
            name: 'validate',
            steps: [
              {
                name: 'Set up job',
                conclusion: 'success',
                started_at: started,
                completed_at: started,
              },
              // The older run has the step's name from before 2026-10-30.
              {
                name: index === 0 ? 'validate' : 'Run bun run validate',
                conclusion: 'success',
                started_at: started,
                completed_at: completed,
              },
            ],
          },
        ],
      },
    ]),
  ),
  [`repos/${repo}`]: { default_branch: 'main' },
  // The open risk-tighten issues. A pull request with the label is not one.
  [`repos/${repo}/issues`]: [
    { number: 7, title: 'Tighten risk? #2 was reverted', html_url: 'u7' },
    { number: 8, title: 'A PR', html_url: 'u8', pull_request: {} },
  ],
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
