import { expect, test } from 'bun:test';

import { fake, fakeClock } from '@tools/github/fake-run';
import { autoMerge, verdictOf, watchMain } from '@tools/github/main-watch';
import type { Result } from '@tools/github/stack';

const timing = { timeout: 600_000, interval: 15_000 };

/** The Auto-merge run that the dispatch started, finished with `conclusion`. */
const decided = (conclusion: string) => ({
  out: JSON.stringify([
    {
      databaseId: 8,
      displayTitle: 'Auto-merge #21',
      status: 'completed',
      conclusion,
      // Later than any dispatch time, so the run counts as this dispatch's.
      createdAt: '2999-01-01T00:00:00Z',
      url: 'https://github.com/acme/shop/actions/runs/8',
    },
  ]),
});

const prState = (state: string, queued: boolean, oid?: string) => ({
  out: JSON.stringify({
    state,
    autoMergeRequest: queued ? { enabledAt: 'now' } : null,
    mergeCommit: oid ? { oid } : null,
  }),
});

test('a dispatch that the judge passes waits for GitHub to merge, and returns the merge commit', async () => {
  const gh = fake([
    ['gh run list --workflow auto-merge.yml', [{ out: '[]' }, decided('success')]],
    [
      'gh pr view 21 --json state,autoMergeRequest,mergeCommit',
      [prState('OPEN', true), prState('MERGED', false, 'm3rge')],
    ],
  ]);
  const clock = fakeClock();
  expect(await autoMerge(gh.run, '21', 'main', { clock, ...timing })).toEqual({
    merged: true,
    sha: 'm3rge',
  });
  expect(gh.calls[0]).toBe('gh workflow run auto-merge.yml --ref main -f pr=21');
  expect(clock.slept).toBe(30_000);
});

test('a PR that the judge holds returns the verdict that the decide job printed', async () => {
  // The form of a real `gh run view --log`, which names no step.
  const log = [
    'decide\tUNKNOWN STEP\t2026-11-06T10:00:01.0000000Z ##[group]Run set -o pipefail',
    'decide\tUNKNOWN STEP\t2026-11-06T10:00:01.1000000Z   HEAD_SHA: h3ad',
    'decide\tUNKNOWN STEP\t2026-11-06T10:00:01.2000000Z ##[endgroup]',
    'decide\tUNKNOWN STEP\t2026-11-06T10:00:02.0000000Z Would not auto-merge at the step medium:',
    'decide\tUNKNOWN STEP\t2026-11-06T10:00:02.1000000Z - The risk tier is one-way-door.',
    'decide\tUNKNOWN STEP\t2026-11-06T10:00:02.2000000Z No dry-run comment: the step medium is the last.',
    'decide\tUNKNOWN STEP\t2026-11-06T10:00:03.0000000Z Post job cleanup.',
    'decide\tUNKNOWN STEP\t2026-11-06T10:00:03.1000000Z [command]/usr/bin/git version',
  ].join('\n');
  const gh = fake([
    ['gh run list --workflow auto-merge.yml', decided('success')],
    ['gh pr view 21 --json state,autoMergeRequest,mergeCommit', prState('OPEN', false)],
    ['gh run view 8 --log', { out: log }],
  ]);
  expect(await autoMerge(gh.run, '21', 'main', { clock: fakeClock(), ...timing })).toEqual({
    merged: false,
    message: [
      'Would not auto-merge at the step medium:',
      '- The risk tier is one-way-door.',
      'No dry-run comment: the step medium is the last.',
    ].join('\n'),
  });
});

test('a failed Auto-merge run fails the merge and names the run', async () => {
  const gh = fake([['gh run list --workflow auto-merge.yml', decided('failure')]]);
  await expect(autoMerge(gh.run, '21', 'main', { clock: fakeClock(), ...timing })).rejects.toThrow(
    'The Auto-merge run for #21 ended failure',
  );
});

test('verdictOf keeps only the lines that the Decide step printed', () => {
  expect(
    verdictOf('decide\tFind\t2026Z x\ndecide\tDecide\t2026-11-06T10:00:00Z Would auto-merge.'),
  ).toBe('Would auto-merge.');
});

/** CI's push runs on main at the merge commit `m3rge`, as `gh run list` prints them. */
const ci = (status: string, conclusion: string, attempt: number) => ({
  out: JSON.stringify([
    {
      databaseId: 77,
      headSha: 'm3rge',
      status,
      conclusion,
      attempt,
      url: 'https://github.com/acme/shop/actions/runs/77',
    },
  ]),
});

/**
 * A main that was green before the merge of #42 at `m3rge`, which fails
 * `validate`. #42 was auto-merged. `answers` come first.
 */
function redAfterMerge(answers: Array<[string, Partial<Result> | Array<Partial<Result>>]>) {
  return fake([
    ...answers,
    [
      'gh run list --repo acme/shop',
      {
        out: JSON.stringify([
          { headSha: 'm3rge', conclusion: 'failure', status: 'completed' },
          { headSha: 'old5678', conclusion: 'success', status: 'completed' },
        ]),
      },
    ],
    ['gh api repos/acme/shop/rules/branches/main', { out: '["validate"]' }],
    // The run before the merge passed, and the merge's run fails.
    ['gh api --paginate repos/acme/shop/actions/runs?head_sha=old5678', { out: '40\n' }],
    ['gh api --paginate repos/acme/shop/actions/runs?head_sha=m3rge', { out: '41\n' }],
    [
      'gh api --paginate repos/acme/shop/actions/runs/40/jobs',
      {
        out: JSON.stringify({
          id: 4000,
          name: 'validate',
          status: 'completed',
          conclusion: 'success',
        }),
      },
    ],
    [
      'gh api --paginate repos/acme/shop/actions/runs/41/jobs',
      {
        out: JSON.stringify({
          id: 4100,
          name: 'validate',
          status: 'completed',
          conclusion: 'failure',
        }),
      },
    ],
    [
      'gh api repos/acme/shop/commits/m3rge ',
      { out: JSON.stringify({ message: 'Merge pull request #42', parents: ['a', 'b'] }) },
    ],
    ['gh api repos/acme/shop/commits/m3rge/pulls', { out: '42\n' }],
    ['gh api --paginate repos/acme/shop/issues/42/comments', { out: '901\n' }],
  ]);
}

const watch = (gh: ReturnType<typeof fake>, clock = fakeClock()) =>
  watchMain(gh.run, {
    clock,
    ...timing,
    repo: 'acme/shop',
    trunk: 'main',
    sha: 'm3rge',
    watch: [],
  });

test('a green CI run on main at the merge commit ends the watch', async () => {
  const gh = fake([
    ['gh run list --workflow ci.yml', [ci('in_progress', '', 1), ci('completed', 'success', 1)]],
  ]);
  expect(await watch(gh)).toBe(0);
  expect(gh.calls.some((call) => call.startsWith('gh run rerun'))).toBe(false);
});

test('a red run reruns once, and a second red run starts the revert of the auto-merged PR', async () => {
  const gh = redAfterMerge([
    [
      'gh run list --workflow ci.yml',
      [
        ci('completed', 'failure', 1),
        ci('completed', 'failure', 1),
        ci('in_progress', '', 2),
        ci('completed', 'failure', 2),
      ],
    ],
  ]);
  expect(await watch(gh)).toBe(1);
  expect(gh.calls.filter((call) => call.startsWith('gh run rerun'))).toEqual([
    'gh run rerun 77 --failed --repo acme/shop',
  ]);
  expect(gh.calls).toContain('gh workflow run revert.yml --repo acme/shop --ref main -f pr=42');
});

test('a red run with no rerun ends the watch at once', async () => {
  // main was red before the merge, so the auto-revert rules rerun nothing.
  const gh = redAfterMerge([
    ['gh run list --workflow ci.yml', ci('completed', 'failure', 1)],
    [
      'gh api --paginate repos/acme/shop/actions/runs/40/jobs',
      {
        out: JSON.stringify({
          id: 4000,
          name: 'validate',
          status: 'completed',
          conclusion: 'failure',
        }),
      },
    ],
  ]);
  const clock = fakeClock();
  expect(await watch(gh, clock)).toBe(1);
  expect(clock.slept).toBe(0);
  expect(gh.calls.some((call) => call.startsWith('gh run rerun'))).toBe(false);
});

test('a repository without ci.yml has no main to watch', async () => {
  const gh = fake([
    [
      'gh run list --workflow ci.yml',
      { ok: false, err: 'HTTP 404: workflow ci.yml not found on the default branch' },
    ],
  ]);
  expect(await watch(gh)).toBe(0);
});
