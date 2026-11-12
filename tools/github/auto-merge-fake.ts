import { expect } from 'bun:test';

import { runAutoMerge } from '@tools/github/auto-merge';
import type { Config, Facts } from '@tools/github/auto-merge-rules';
import type { Result, Run } from '@tools/github/stack';

/** The fixtures of the auto-merge tests: a green agent PR on a green main, and a runner that answers its `gh` calls. */

export const head = 'a1b2c3d4e5f6';
export const agent = { login: 'eggdev', is_bot: false };
export const app = { login: 'app/renovate', is_bot: true };

export const facts = (fields: Partial<Facts> = {}, pr: Partial<Facts['pr']> = {}): Facts => ({
  pr: {
    state: 'OPEN',
    isDraft: false,
    baseRefName: 'main',
    headRefName: 'clutch/cl-123-docs',
    headRefOid: head,
    author: agent,
    ...pr,
  },
  defaultBranch: 'main',
  tier: 'low',
  checks: { validate: 'success', 'agent-review': 'success' },
  weakerJourneys: [],
  botProblems: [],
  mainRed: [],
  ownerApproved: false,
  ...fields,
});

/** Check runs of the head: a failed validate, then a newer one with `conclusion`. */
const runs = (conclusion: string) =>
  [
    { id: 1, name: 'validate', status: 'completed', conclusion: 'failure' },
    { id: 2, name: 'validate', status: 'completed', conclusion },
    { id: 3, name: 'agent-review', status: 'completed', conclusion: 'success' },
  ]
    .map((line) => JSON.stringify({ ...line, app: 'github-actions' }))
    .join('\n');

/** A fake runner for a green, low-risk agent PR on a green main. `answers` override by prefix. */
export function fake(
  answers: Array<[string, Partial<Result>]> = [],
  pr: Partial<Facts['pr']> = {},
) {
  const calls: Array<string> = [];
  const defaults: Array<[string, Partial<Result>]> = [
    ['gh repo view --json nameWithOwner', { out: 'eggdev/clutch\n' }],
    ['gh repo view --json defaultBranchRef', { out: 'main\n' }],
    ['gh pr view', { out: JSON.stringify(facts({}, pr).pr) }],
    ['gh api repos/eggdev/clutch/rules/branches/main', { out: '["validate"]' }],
    ['gh api repos/eggdev/clutch/commits/main --jq .sha', { out: 'mainsha\n' }],
    ['gh api --paginate repos/eggdev/clutch/commits/', { out: runs('success') }],
    ['gh pr list --state merged', { out: '[]' }],
    ['gh api --paginate repos/eggdev/clutch/pulls/7/reviews', { out: '' }],
    ['bun tools/clutch.ts risk', { out: '{"tier":"low"}' }],
    ['gh api --paginate repos/eggdev/clutch/issues/7/comments', { out: 'LGTM\n' }],
    [
      'gh api --paginate repos/eggdev/clutch/pulls/7/files',
      { out: JSON.stringify({ filename: 'bun.lock', patch: '-a\n+b' }) },
    ],
  ];
  const run: Run = (command) => {
    const line = command.join(' ');
    calls.push(line);
    const answer = [...answers, ...defaults].find(([prefix]) => line.startsWith(prefix))?.[1];
    return Promise.resolve({ ok: true, out: '', err: '', ...answer });
  };
  return { run, calls };
}

export const args = ['--pr', '7', '--head', head];
export const merges = (calls: Array<string>) =>
  calls.filter((call) => call.startsWith('gh pr merge'));
export const comments = (calls: Array<string>) =>
  calls.filter((call) => call.startsWith('gh pr comment'));

export async function decide(gh: ReturnType<typeof fake>, config: Config) {
  const lines: Array<string> = [];
  expect(await runAutoMerge(args, gh.run, config, (line) => lines.push(line))).toBe(0);
  return lines;
}
