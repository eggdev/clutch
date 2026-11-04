import { expect, test } from 'bun:test';

import {
  factoryDefinitions,
  factoryMetrics,
  humanCommits,
  isToolCommit,
  laneStart,
  openedByPerson,
  reverts,
  withAgentReview,
} from '@/metrics/factory';
import type { FactoryPull, PullCommit } from '@/metrics/factory';
import { issueIdOf } from '@/metrics/factory-reader';

const repo = 'acme/shop';
const prefix = 'clutch/cl-';
const trailer = '\n\nCo-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>';

const commit = (sha: string, message: string, at: string, extra: Partial<PullCommit> = {}) => ({
  sha,
  message,
  authoredAt: `2026-10-10T${at}:00Z`,
  bot: false,
  merge: false,
  ...extra,
});

const pull = (number: number, extra: Partial<FactoryPull> = {}): FactoryPull => ({
  number,
  title: `feat: change ${number}`,
  body: '',
  headRef: `clutch/cl-${number}-change`,
  labels: [],
  createdAt: '2026-10-10T02:00:00Z',
  mergedAt: `2026-10-10T${String(number + 4).padStart(2, '0')}:00:00Z`,
  mergeSha: `merge${number}`,
  commits: [commit(`a${number}`, `feat: change ${number}${trailer}`, '01:00')],
  firstReviewAt: '2026-10-10T03:00:00Z',
  ...extra,
});

// An agent-only PR: each commit has the agent trailer, and the tool's changeset has none.
const agentOnly = pull(1, {
  commits: [
    commit('a1', `feat: change 1${trailer}`, '01:00'),
    commit('b1', 'chore(changeset): add a minor changeset for this PR', '01:30'),
    commit('c1', 'chore(tracker): mark CL-001 done', '01:31'),
  ],
});

// An agent PR where a person pushed a fixup.
const humanFixup = pull(2, {
  commits: [
    commit('a2', `feat: change 2${trailer}`, '01:00'),
    commit('b2', 'fix: the typo the agent left', '02:30'),
  ],
});

// A PR that a person opened, from their own branch, with no agent in it.
const personOpened = pull(3, {
  headRef: 'jane/tweak',
  commits: [commit('a3', 'docs: tweak the readme', '01:00')],
});

// A PR with no review at all, whose lane started when its issue went in_progress.
const noReview = pull(4, { firstReviewAt: undefined, inProgressAt: '2026-10-09T20:00:00Z' });

// A revert that the Revert workflow opened for PR 1: a bot commit, and a person's "Update branch" merge.
const revertOfOne = pull(5, {
  title: 'revert: feat: change 1',
  headRef: 'revert/1',
  createdAt: '2026-10-10T05:45:00Z',
  firstReviewAt: '2026-10-10T06:00:00Z',
  body: 'Reverts #1 (merge commit merge1).',
  commits: [
    commit('a5', 'revert: feat: change 1\n\nThis reverts #1, merge commit merge1.', '05:30', {
      bot: true,
    }),
    commit('b5', "Merge branch 'main' into revert/1", '05:40', { merge: true }),
  ],
});

test('tool commits and their subjects alone are not a push by a person', () => {
  expect(isToolCommit('chore(changeset): add a patch changeset for this PR')).toBe(true);
  expect(isToolCommit('chore(changeset): add an minor changeset for this PR\n')).toBe(true);
  expect(isToolCommit('chore(tracker): mark CL-025b done')).toBe(true);
  expect(isToolCommit('chore(tracker): start CL-141')).toBe(false);
  expect(humanCommits(agentOnly)).toEqual([]);
  expect(humanCommits(humanFixup).map((item) => item.sha)).toEqual(['b2']);
  expect(humanCommits(revertOfOne)).toEqual([]);
});

test('a person opened a PR only off an agent branch, with a first commit by no agent or bot', () => {
  expect(openedByPerson(personOpened, prefix)).toBe(true);
  expect(openedByPerson(agentOnly, prefix)).toBe(false);
  expect(openedByPerson(revertOfOne, prefix)).toBe(false);
  // An agent's commit on a branch without the prefix is still an agent's PR.
  expect(openedByPerson({ ...agentOnly, headRef: 'clutch/fix-it' }, prefix)).toBe(false);
  // A person's first commit on an agent branch is a push, but not the opening.
  expect(openedByPerson({ ...personOpened, headRef: 'clutch/cl-3-x' }, prefix)).toBe(false);
});

test('the lane starts at the first commit, or at the in_progress commit when it is earlier', () => {
  expect(laneStart(agentOnly)).toBe('2026-10-10T01:00:00Z');
  expect(laneStart(noReview)).toBe('2026-10-09T20:00:00Z');
  expect(laneStart({ ...agentOnly, inProgressAt: '2026-10-10T01:30:00Z' })).toBe(
    '2026-10-10T01:00:00Z',
  );
});

test('a revert names its target by branch, number, commit or title', () => {
  const target = pull(1);
  const later = (extra: Partial<FactoryPull>) =>
    pull(6, { headRef: 'jane/undo', commits: [commit('a6', 'undo', '09:00')], ...extra });
  expect(reverts(revertOfOne, target, repo)).toBe(true);
  expect(reverts(later({ body: 'Reverts acme/shop#1' }), target, repo)).toBe(true);
  expect(reverts(later({ body: 'Reverts other/shop#1' }), target, repo)).toBe(false);
  expect(reverts(later({ body: 'Reverts #12' }), target, repo)).toBe(false);
  expect(
    reverts(
      later({ commits: [commit('a6', 'Revert "x"\n\nThis reverts commit abc1234.', '09:00')] }),
      { ...target, mergeSha: 'abc1234def5678' },
      repo,
    ),
  ).toBe(true);
  expect(reverts(later({ title: 'Revert "feat: change 1"' }), target, repo)).toBe(true);
  expect(reverts(later({ title: 'revert: feat: chan...' }), target, repo)).toBe(true);
  // A revert merged before its target reverts nothing.
  expect(reverts({ ...revertOfOne, mergedAt: '2026-10-10T04:00:00Z' }, target, repo)).toBe(false);
});

test('the factory numbers follow the definitions, with a count for each', () => {
  const pulls = [agentOnly, humanFixup, personOpened, noReview, revertOfOne];
  const { pulls: rows, ...factory } = factoryMetrics(pulls, { repo, branchPrefix: prefix });
  expect(rows[3]).toEqual({
    number: 4,
    laneStart: '2026-10-09T20:00:00Z',
    openedAt: '2026-10-10T02:00:00Z',
    firstReviewAt: null,
    mergedAt: '2026-10-10T08:00:00Z',
    humanPush: false,
    reverted: false,
  });
  expect(rows.filter((row) => row.humanPush).map((row) => row.number)).toEqual([2, 3]);
  expect(rows.filter((row) => row.reverted).map((row) => row.number)).toEqual([1]);
  expect(factory).toEqual({
    definitions: factoryDefinitions,
    merged: 5,
    autonomy: { autonomous: 3, merged: 5, share: 0.6, humanPushed: [2, 3] },
    cycleTimeHours: {
      // 1 h for 3 PRs, 6 h for PR 4, whose issue went in_progress first, and 0.25 h for the revert.
      toPr: { p50: 1, p90: 4, count: 5 },
      // PR 4 has no review, so it is left out.
      toFirstReview: { p50: 2, p90: 2, count: 4 },
      toMerge: { p50: 5, p90: 9.6, count: 5 },
    },
    reverts: { reverted: 1, merged: 5, rate: 0.2, brake: 0.02, overBrake: true, pulls: [1] },
  });
});

test('a drill does not count as a revert or as a reverted PR, and no PRs give null shares', () => {
  const drill = { ...revertOfOne, labels: ['drill'] };
  expect(factoryMetrics([agentOnly, drill], { repo, branchPrefix: prefix }).reverts).toMatchObject({
    reverted: 0,
    rate: 0,
    overBrake: false,
  });
  const target = { ...agentOnly, labels: ['drill'] };
  expect(
    factoryMetrics([target, revertOfOne], { repo, branchPrefix: prefix }).reverts.reverted,
  ).toBe(0);
  const empty = factoryMetrics([], { repo, branchPrefix: prefix });
  expect(empty.autonomy.share).toBeNull();
  expect(empty.reverts).toMatchObject({ rate: null, overBrake: false });
  expect(empty.cycleTimeHours.toMerge).toEqual({ p50: null, p90: null, count: 0 });
});

test('the issue id comes from the end of the title, else from the branch', () => {
  expect(issueIdOf('feat(metrics): report autonomy (CL-141)', 'clutch/cl-999-x')).toBe('CL-141');
  expect(issueIdOf('fix: a thing', 'clutch/cl-025b-clutch-binary')).toBe('CL-025b');
  expect(issueIdOf('docs: name the label (N-49)', 'clutch/cl-n-49-label')).toBe('N-49');
  expect(issueIdOf('chore: tidy', 'renovate/eslint-monorepo')).toBeUndefined();
});

test('the first review is the earliest submitted review or agent review run on a commit', () => {
  const runs = new Map([
    ['a1', '2026-10-10T02:30:00Z'],
    ['other', '2026-10-10T00:00:00Z'],
  ]);
  expect(withAgentReview(agentOnly, runs).firstReviewAt).toBe('2026-10-10T02:30:00Z');
  expect(
    withAgentReview({ ...agentOnly, firstReviewAt: '2026-10-10T02:10:00Z' }, runs).firstReviewAt,
  ).toBe('2026-10-10T02:10:00Z');
  expect(withAgentReview(noReview, new Map()).firstReviewAt).toBeUndefined();
});
