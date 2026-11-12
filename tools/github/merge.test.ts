import { expect, test } from 'bun:test';

import {
  fake,
  fakeClock,
  findingsOn,
  noWrite,
  repoOwner,
  reviewsOf,
  trunk,
} from '@tools/github/fake-run';
import type { Reviewed } from '@tools/github/fake-run';
import { runPr } from '@tools/github/pr';

/** CI's push run on main at the merge commit, green. */
const mainGreen: [string, { out: string }] = [
  'gh run list --workflow ci.yml',
  {
    out: JSON.stringify([
      {
        databaseId: 5,
        headSha: 'm3rge',
        status: 'completed',
        conclusion: 'success',
        attempt: 1,
        url: 'https://github.com/o/r/actions/runs/5',
      },
    ]),
  },
];

const succeeded = {
  out: JSON.stringify([
    {
      headSha: 'm3rge',
      status: 'completed',
      conclusion: 'success',
      url: 'https://github.com/o/r/actions/runs/9',
    },
  ]),
};

/** A merge of PR 17 at `headSha` with one owner finding, and the reviews that the owner has left. */
function mergingWithFinding(
  headSha: string,
  reviews: Array<Reviewed>,
  reviewDecision = '',
  first: Parameters<typeof fake>[0] = [],
) {
  return fake([
    ...first,
    trunk,
    ['gh pr view 17 --json mergeCommit', { out: 'm3rge' }],
    [
      'gh pr view 17',
      {
        out: JSON.stringify({
          baseRefName: 'main',
          headRefName: 'cl-027',
          headRefOid: headSha,
          reviewDecision,
          mergeStateStatus: 'CLEAN',
          reviewRequests: [],
          latestReviews: [],
        }),
      },
    ],
    ['gh pr list --state open --base cl-027', { out: '[]' }],
    ['gh run list --workflow release.yml', succeeded],
    mainGreen,
    ['git show origin/main:package.json', { out: '{"version":"1.2.3"}' }],
    ...findingsOn(headSha, ['**owner**: weaker check.']),
    reviewsOf('17', ...reviews),
  ]);
}

/**
 * What `merge` does with PR 17's owner finding: `merged`, or the message of its
 * refusal, and the merge commands that it ran.
 */
async function mergeOutcome(reviews: Array<Reviewed>, reviewDecision = '') {
  const gh = mergingWithFinding('h3ad', reviews, reviewDecision);
  const merges = () =>
    gh.calls.filter((call) => call.startsWith('gh pr merge') || call.startsWith('gh stack merge'));
  try {
    await runPr(['merge', '17', '--owner'], gh.run, noWrite, fakeClock());
    return { outcome: 'merged', merges: merges() };
  } catch (error) {
    const outcome = error instanceof Error ? error.message : String(error);
    return { outcome, merges: merges() };
  }
}

test('merge proceeds with an owner finding once the owner approves the current head', async () => {
  const me = await repoOwner();
  const gh = mergingWithFinding('h3ad', [{ login: me, state: 'APPROVED', commit: 'h3ad' }]);
  expect(await runPr(['merge', '17', '--owner'], gh.run, noWrite, fakeClock())).toBe(0);
  expect(gh.calls).toContain('gh pr merge 17 --merge');
});

test('a model owner finding does not refuse the merge', async () => {
  const { outcome } = await mergeOutcome([]);
  expect(String(outcome)).not.toContain('owner finding');
});

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
    mainGreen,
    ['git show origin/main:package.json', { out: '{"version":"1.2.3"}' }],
  ]);
  const clock = fakeClock();
  expect(await runPr(['merge', '12', '--owner'], gh.run, noWrite, clock)).toBe(0);
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
  expect(await runPr(['merge', '12', '--owner'], failed.run, noWrite, fakeClock())).toBe(1);
  expect(failed.calls.some((call) => call.startsWith('gh stack'))).toBe(false);

  const refused = fake([
    trunk,
    ['gh pr view 12', { out: '{"baseRefName":"main","headRefName":"cl-024"}' }],
    ['gh pr list --state open --base cl-024', { out: '[]' }],
    ['gh pr merge 12 --merge', { ok: false, err: 'Pull request is not mergeable' }],
  ]);
  await expect(
    runPr(['merge', '12', '--owner'], refused.run, noWrite, fakeClock()),
  ).rejects.toThrow('not mergeable');
});

const releaseLookup = (err: string) =>
  fake([
    trunk,
    ['gh pr view 12 --json mergeCommit', { out: 'm3rge' }],
    ['gh pr view 12', { out: '{"baseRefName":"main","headRefName":"cl-024"}' }],
    ['gh pr list --state open --base cl-024', { out: '[]' }],
    ['gh run list --workflow release.yml', { ok: false, err }],
    mainGreen,
  ]);

test('merge passes without release.yml, and fails when it cannot read the release runs', async () => {
  const missing = releaseLookup('HTTP 404: workflow release.yml not found on the default branch');
  expect(await runPr(['merge', '12', '--owner'], missing.run, noWrite, fakeClock())).toBe(0);
  const offline = releaseLookup('error connecting to api.github.com');
  expect(await runPr(['merge', '12', '--owner'], offline.run, noWrite, fakeClock())).toBe(1);
});

test('merge of a PR that the owner approval already merged goes on to the release and main', async () => {
  const gh = fake([
    trunk,
    [
      'gh pr view 17',
      {
        out: JSON.stringify({
          state: 'MERGED',
          mergeCommit: { oid: 'm3rge' },
          baseRefName: 'main',
          headRefName: 'cl-027',
          headRefOid: 'h3ad',
        }),
      },
    ],
    ['gh run list --workflow release.yml', succeeded],
    mainGreen,
    ['git show origin/main:package.json', { out: '{"version":"1.2.3"}' }],
  ]);
  expect(await runPr(['merge', '17'], gh.run, noWrite, fakeClock())).toBe(0);
  expect(gh.calls.some((call) => call.startsWith('gh workflow run auto-merge.yml'))).toBe(false);
  expect(gh.calls.some((call) => call.startsWith('gh run list --workflow ci.yml'))).toBe(true);
});

test('merge prints the verdict and exits 3 when the judge holds a PR for a contract break', async () => {
  const verdict = [
    'Would not auto-merge at the step medium:',
    '- The contract snapshot names the break Note.title. The owner agrees to a break.',
  ];
  const decided = JSON.stringify([
    {
      databaseId: 8,
      displayTitle: 'Auto-merge #17',
      status: 'completed',
      conclusion: 'success',
      createdAt: '2026-11-06T10:00:00Z',
      url: 'https://github.com/o/r/actions/runs/8',
    },
  ]);
  const gh = mergingWithFinding('h3ad', [], '', [
    ['gh run list --workflow auto-merge.yml', [{ out: '[]' }, { out: decided }]],
    [
      'gh pr view 17 --json state,autoMergeRequest,mergeCommit',
      { out: JSON.stringify({ state: 'OPEN', autoMergeRequest: null, mergeCommit: null }) },
    ],
    [
      'gh run view 8 --log',
      { out: verdict.map((line) => `decide\tDecide\t2026-11-06T10:00:02Z ${line}`).join('\n') },
    ],
  ]);
  const printed: Array<string> = [];
  const { log } = console;
  console.log = (line: string) => printed.push(line);
  try {
    expect(await runPr(['merge', '17'], gh.run, noWrite, fakeClock())).toBe(3);
  } finally {
    console.log = log;
  }
  expect(printed).toContain(verdict.join('\n'));
  expect(gh.calls).toContain('gh workflow run auto-merge.yml --ref main -f pr=17');
  expect(gh.calls.some((call) => call.startsWith('gh pr merge'))).toBe(false);
});
