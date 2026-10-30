import { expect, test } from 'bun:test';

import {
  agentsIn,
  ciMetrics,
  dryRunAgreement,
  flowMetrics,
  isRevert,
  mainRedMinutes,
  percentile,
} from '@/metrics/compute';
import type { CheckRun, MainCommit, MergedPull } from '@/metrics/compute';

const run = (name: string, conclusion: string, completedAt: string): CheckRun => ({
  name,
  status: 'completed',
  conclusion,
  completedAt: `2026-10-01T${completedAt}:00Z`,
});
const commit = (sha: string, ...checks: Array<CheckRun>): MainCommit => ({
  sha,
  message: '',
  checks,
});
const since = '2026-10-01T00:00:00Z';
const until = '2026-10-01T12:00:00Z';

test('percentile interpolates between the nearest values and is null for none', () => {
  expect(percentile([4, 1, 3, 2], 50)).toBe(2.5);
  expect(percentile([1, 2, 3, 4, 5, 6, 7, 8, 9, 10], 90)).toBe(9.1);
  expect(percentile([], 50)).toBeNull();
});

test('agents come only from Co-authored-by trailers', () => {
  const message =
    'feat: x\n\nThanks to Claude for the idea.\n\nCo-authored-by: Claude Opus 5.5 <noreply@anthropic.com>\nCo-Authored-By: Jane <jane@example.com>\nco-authored-by: Copilot <copilot@github.com>';
  expect(agentsIn(message).toSorted()).toEqual(['claude', 'copilot']);
  expect(agentsIn('fix: claude wrote nothing here')).toEqual([]);
});

test('a revert is a Revert title or a git revert body', () => {
  expect(isRevert('Revert "feat: add x"')).toBe(true);
  expect(isRevert('revert(cli): undo x')).toBe(true);
  expect(isRevert('fix: x\n\nThis reverts commit abc1234def.')).toBe(true);
  expect(isRevert('fix: handle reverted rows')).toBe(false);
});

test('main is red from the first failing required check to the next all-green commit', () => {
  const commits = [
    commit('a', run('validate', 'success', '01:00')),
    commit('b', run('validate', 'failure', '02:00'), run('lint', 'failure', '02:00')),
    // Pending checks leave main red.
    commit('c', { name: 'validate', status: 'in_progress', conclusion: null, completedAt: null }),
    commit('d', run('validate', 'success', '03:30')),
  ];
  expect(mainRedMinutes(commits, ['validate'], since, until)).toBe(90);
});

test('a rerun that passes ends the red time on the same commit', () => {
  const commits = [
    commit('a', run('validate', 'failure', '01:00'), run('validate', 'success', '01:20')),
  ];
  expect(mainRedMinutes(commits, ['validate'], since, until)).toBe(20);
});

test('a check that only later commits run does not keep older commits red', () => {
  const commits = [
    commit('a', run('validate', 'failure', '01:00')),
    commit('b', run('validate', 'success', '02:00')),
    commit('c', run('validate', 'success', '03:00'), run('secrets', 'failure', '03:00')),
  ];
  expect(mainRedMinutes(commits, ['validate', 'secrets'], since, until)).toBe(60 + 9 * 60);
});

test('red time is clipped to the window', () => {
  const commits = [
    commit('before', run('validate', 'failure', '00:00')),
    commit('a', run('validate', 'success', '06:00')),
  ];
  expect(mainRedMinutes(commits, ['validate'], '2026-10-01T04:00:00Z', until)).toBe(120);
});

test('a late green on an older commit does not end the red of a newer one', () => {
  const commits = [
    commit('older', run('validate', 'success', '03:00')),
    commit('newer', run('validate', 'failure', '02:00')),
  ];
  expect(mainRedMinutes(commits, ['validate'], since, until)).toBe(10 * 60);
});

const pull = (overrides: Partial<MergedPull>): MergedPull => ({
  number: 1,
  title: 'feat: x',
  createdAt: '2026-10-01T00:00:00Z',
  mergedAt: '2026-10-01T02:00:00Z',
  humanAction: true,
  commitMessages: [],
  ...overrides,
});

test('flow metrics count merges, people, waits, reverts and agent trailers', () => {
  const agent = 'feat: x\n\nCo-authored-by: Codex <codex@openai.com>';
  const flow = flowMetrics(
    [
      pull({ humanAction: false, lastGreenAt: '2026-10-01T01:30:00Z', commitMessages: [agent] }),
      pull({ mergedAt: '2026-10-01T04:00:00Z', commitMessages: ['fix: y', agent] }),
      pull({ title: 'Revert "feat: x"', commitMessages: ['Revert "feat: x"'] }),
      pull({ mergedAt: '2026-10-01T10:00:00Z' }),
    ],
    2,
  );
  expect(flow).toMatchObject({
    merged: 4,
    mergedPerDay: 2,
    noHumanAction: { count: 1, share: 0.25 },
    openToMergeHours: { p50: 3, p90: 8.2, count: 4 },
    greenToMergeHours: { p50: 0.5, count: 1 },
    agents: {
      commits: 4,
      agentCommits: 2,
      commitShare: 0.5,
      pullShare: 0.5,
      byAgent: { codex: 2 },
    },
    revertPulls: 1,
  });
});

test('flow metrics for an empty window have no shares and no percentiles', () => {
  const flow = flowMetrics([], 14);
  expect(flow.noHumanAction.share).toBeNull();
  expect(flow.openToMergeHours.p50).toBeNull();
  expect(flow.agents.pullShare).toBeNull();
});

const at = (minute: number) => `2026-10-01T00:${String(minute).padStart(2, '0')}:00Z`;

test('CI metrics skip unfinished and skipped runs', () => {
  const ci = ciMetrics([
    { conclusion: 'success', runStartedAt: at(0), updatedAt: at(2) },
    { conclusion: 'failure', runStartedAt: at(0), updatedAt: at(4) },
    { conclusion: null, runStartedAt: at(0), updatedAt: at(9) },
    { conclusion: 'skipped', runStartedAt: at(0), updatedAt: at(0) },
  ]);
  expect(ci).toMatchObject({ runs: 2, failureRate: 0.5, durationMinutes: { p50: 3, count: 2 } });
});

const verdict = (number: number, day: number, thumbsUp: number, thumbsDown: number) => ({
  pull: number,
  createdAt: `2026-10-${String(day).padStart(2, '0')}T00:00:00Z`,
  wouldMerge: number % 2 === 0,
  thumbsUp,
  thumbsDown,
});

test('dry-run agreement counts reactions, and the streak runs back to the latest 👎', () => {
  expect(
    dryRunAgreement([
      verdict(5, 5, 1, 0),
      verdict(1, 1, 1, 0),
      verdict(2, 2, 0, 1),
      verdict(3, 3, 1, 0),
      verdict(4, 4, 0, 0),
    ]),
  ).toEqual({
    verdicts: 5,
    wouldMerge: 2,
    agreed: 3,
    disagreed: 1,
    unanswered: 1,
    streak: 2,
    disagreedPulls: [2],
  });
  expect(dryRunAgreement([]).streak).toBe(0);
});
