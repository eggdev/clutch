import { expect, test } from 'bun:test';

import { agentBranchShare, byStep, prSize, stepOf } from '@/metrics/pulls';
import type { PullShape } from '@/metrics/pulls';

const pull = (overrides: Partial<PullShape>): PullShape => ({
  number: 1,
  humanAction: false,
  headRef: 'clutch/cl-001-x',
  author: { login: 'jane', bot: false },
  labels: [],
  numstat: '',
  ...overrides,
});

test('a marker from auto-merge decides the step, and a bad one is ignored', () => {
  expect(stepOf(pull({ markedStep: 'medium', labels: ['risk/low'] }))).toEqual({
    step: 'medium',
    from: 'marker',
  });
  expect(stepOf(pull({ markedStep: 'later', labels: ['risk/low'] }))).toEqual({
    step: 'low',
    from: 'inferred',
  });
});

test('without a marker, a bot author or branch is bots, then the risk label decides', () => {
  expect(stepOf(pull({ author: { login: 'renovate[bot]', bot: true } })).step).toBe('bots');
  expect(stepOf(pull({ headRef: 'gardening/2026-10-30' })).step).toBe('bots');
  expect(stepOf(pull({ labels: ['risk/medium'] })).step).toBe('medium');
  expect(stepOf(pull({ labels: ['risk/high'] })).step).toBe('unattributed');
});

test('the breakdown counts only merges with no human action', () => {
  const counts = byStep([
    pull({ labels: ['risk/low'] }),
    pull({ labels: ['risk/low'], humanAction: true }),
    pull({ markedStep: 'bots' }),
  ]);
  expect(counts).toEqual({ bots: 1, low: 1, medium: 0, unattributed: 0, marked: 1 });
});

test('size skips lockfiles and the project excludes, and labels each PR', () => {
  const size = prSize(
    [
      pull({ numstat: '50\t10\tsrc/a.ts\n900\t900\tbun.lock' }),
      pull({ numstat: '600\t300\tsrc/gen/api.ts\n10\t0\tsrc/b.ts' }),
    ],
    ['src/gen/**'],
  );
  expect(size).toEqual({
    lines: { p50: 35, p90: 55, count: 2 },
    labels: { 'size/S': 2, 'size/M': 0, 'size/L': 0, 'size/XL': 0 },
  });
});

test('the agent share counts the branches with the prefix', () => {
  expect(agentBranchShare([pull({}), pull({ headRef: 'feature/x' })], 'clutch/cl-')).toEqual({
    prefix: 'clutch/cl-',
    pulls: 1,
    share: 0.5,
  });
  expect(agentBranchShare([], 'agent/')).toEqual({ prefix: 'agent/', pulls: 0, share: null });
});
