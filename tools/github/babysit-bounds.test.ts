import { expect, test } from 'bun:test';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { fixesPerCheck, plan } from '@tools/github/babysit';
import { answerChecks } from '@tools/github/babysit-answer';
import { emptyLog } from '@tools/github/babysit-log';
import type { Round } from '@tools/github/babysit-log';
import type { PrState } from '@tools/github/babysit-read';
import { fake } from '@tools/github/fake-run';

const now = '2026-11-16T12:00:00Z';
const failed = [{ name: 'unit', url: 'https://github.com/acme/shop/actions/runs/42/job/1' }];

const state = (fields: Partial<PrState> = {}): PrState => ({
  number: 7,
  url: 'https://github.com/acme/shop/pull/7',
  draft: false,
  open: true,
  fork: false,
  author: 'app/eggdev-clutch-bot',
  authorIsBot: true,
  head: 'head000',
  headRef: 'clutch/cl-557-x',
  base: 'main',
  labels: [],
  mergeable: 'MERGEABLE',
  behindBy: 0,
  failed,
  pending: 0,
  threads: [],
  comments: [],
  approved: false,
  log: emptyLog(),
  logId: null,
  ...fields,
});

/** A round that pushed a fix for the `unit` check. Each fix makes a new head. */
const fixRound = (n: number): Round => ({
  at: `2026-11-16T0${n}:00:00Z`,
  run: '',
  event: 'session',
  triggers: ['red-check'],
  head: `head00${n - 1}`,
  sync: 'none',
  items: [
    {
      kind: 'check',
      ref: 'unit',
      url: '',
      author: 'ci',
      decision: 'must-fix',
      reason: `fix ${n}`,
      action: `fixed in fix${n}000`,
      resolved: false,
    },
  ],
  pushed: `fix${n}000`,
  cost: { usd: 0, models: [] },
  outcome: 'done',
  note: '',
});

const afterFixes = (count: number, fields: Partial<PrState> = {}) =>
  plan(
    state({
      head: `fix${count}000`,
      log: {
        version: 1,
        answered: [],
        rounds: Array.from({ length: count }, (_, i) => fixRound(i + 1)),
      },
      ...fields,
    }),
    now,
  );

test('a check that fails after its third fix needs the owner now, and not after its second', () => {
  const second = afterFixes(fixesPerCheck - 1);
  expect(second.ownerNow).toEqual([]);
  expect(second.skip).toBeNull();
  const third = afterFixes(fixesPerCheck);
  expect(third.stuck).toBe(true);
  expect(third.skip).toBe('unit still failed after 3 fixes and needs the owner now');
  expect(third.ownerNow).toEqual([
    {
      name: 'unit',
      fixes: [1, 2, 3].map((n) => ({ pushed: `fix${n}000`, reason: `fix ${n}` })),
    },
  ]);
  // A check that passes now needs no one, and a person's new comment starts the count again.
  expect(afterFixes(fixesPerCheck, { failed: [] }).ownerNow).toEqual([]);
  const comments = [{ id: 9, author: 'eggdev', body: 'Try a mock.', at: now, url: '' }];
  expect(afterFixes(fixesPerCheck, { comments }).ownerNow).toEqual([]);
});

test('a flaky rerun writes one flake entry to the friction log', async () => {
  const dir = await mkdtemp(path.join(tmpdir(), 'babysit-flake-'));
  try {
    const file = path.join(dir, '.clutch', 'friction.jsonl');
    const gh = fake([]);
    const items = await answerChecks({
      run: gh.run,
      repo: 'acme/shop',
      plan: plan(state(), now),
      answers: [
        {
          kind: 'check',
          ref: 'unit',
          decision: 'flaky',
          reason: 'timeout',
          reply: '',
          test: 'parses a date',
        },
      ],
      pushed: null,
      friction: { file, branch: 'clutch/cl-557-x', at: now },
    });
    expect(items[0]?.action).toBe('reran the failed jobs');
    expect(gh.calls).toEqual(['gh run rerun 42 --failed --repo acme/shop']);
    const text = await readFile(file, 'utf-8');
    const lines = text.trim().split('\n');
    expect(lines.map((line) => JSON.parse(line) as unknown)).toEqual([
      {
        at: now,
        issue: null,
        kind: 'flake',
        text: 'PR #7 reran check unit, test parses a date as flaky at head000',
        branch: 'clutch/cl-557-x',
      },
    ]);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
