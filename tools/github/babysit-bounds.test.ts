import { expect, test } from 'bun:test';

import { fixesPerCheck, plan, replyMarker, stuckLabel } from '@tools/github/babysit';
import { answerChecks } from '@tools/github/babysit-answer';
import { emptyLog, renderLog } from '@tools/github/babysit-log';
import type { Round } from '@tools/github/babysit-log';
import { ownerEvidence } from '@tools/github/babysit-owner';
import type { Comment, PrState } from '@tools/github/babysit-read';
import { fake } from '@tools/github/fake-run';

const now = '2026-11-16T23:00:00Z';
const runUrl = (id: number) => `https://github.com/acme/shop/actions/runs/${id}/job/1`;
const unit = { name: 'unit', url: runUrl(42) };
const lint = { name: 'lint', url: runUrl(43) };

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
  failed: [unit],
  pending: 0,
  threads: [],
  comments: [],
  approved: false,
  log: emptyLog(),
  logId: null,
  viewer: 'eggdev',
  ...fields,
});

const at = (hour: number) => `2026-11-16T${String(hour).padStart(2, '0')}:00:00Z`;

/** Round `n` at hour `n`: it pushed `fix<n>000` for each of `checks`, which failed at its head. */
const round = (n: number, checks = ['unit'], fields: Partial<Round> = {}): Round => ({
  at: at(n),
  run: '',
  event: 'session',
  triggers: ['red-check'],
  head: `fix${n - 1}000`,
  sync: 'none',
  items: checks.map((ref) => ({
    kind: 'check' as const,
    ref,
    url: '',
    author: 'ci',
    decision: 'must-fix' as const,
    reason: `fix ${n}`,
    action: `fixed in fix${n}000`,
    resolved: false,
  })),
  pushed: `fix${n}000`,
  cost: { usd: 0, models: [] },
  outcome: 'done',
  note: '',
  ...fields,
});

const planOf = (rounds: Array<Round>, fields: Partial<PrState> = {}) =>
  plan(
    state({
      head: rounds.findLast((r) => r.pushed)?.pushed ?? 'head000',
      log: { version: 1, answered: [], rounds },
      ...fields,
    }),
    now,
  );

const fixRounds = (count: number, from = 1) =>
  Array.from({ length: count }, (_, i) => round(from + i));

const comment = (author: string, body: string, hour: number): Comment => ({
  id: hour,
  author,
  body,
  at: at(hour),
  url: '',
});

test('a check that fails after its third fix needs the owner now, and not after its second', () => {
  const second = planOf(fixRounds(fixesPerCheck - 1));
  expect(second.ownerNow).toEqual([]);
  expect(second.skip).toBeNull();
  const third = planOf(fixRounds(fixesPerCheck));
  expect(third.stuck).toBe(true);
  expect(third.skip).toBe('unit still failed after 3 fixes and needs the owner now');
  expect(third.ownerNow).toEqual([
    {
      name: 'unit',
      url: runUrl(42),
      fixes: [1, 2, 3].map((n) => ({ pushed: `fix${n}000`, reason: `fix ${n}` })),
    },
  ]);
  expect(planOf(fixRounds(fixesPerCheck), { failed: [] }).ownerNow).toEqual([]);
});

test('after the owner answers a stuck ask, the count starts again from the stuck round', () => {
  const stuck = round(4, [], { pushed: null, outcome: 'stuck', head: 'fix3000' });
  // The owner answered in the chat, and the session pushed a fourth fix outside a round.
  const answered = { labels: [stuckLabel], head: 'fix4000' };
  expect(planOf([...fixRounds(3), stuck], answered).ownerNow).toEqual([]);
  expect(planOf([...fixRounds(3), stuck, ...fixRounds(2, 5)], answered).skip).toBeNull();
  const again = planOf([...fixRounds(3), stuck, ...fixRounds(3, 5)]);
  expect(again.ownerNow.map((c) => c.fixes.map((f) => f.pushed))).toEqual([
    ['fix5000', 'fix6000', 'fix7000'],
  ]);
});

test("the session's own comment does not start the count again, and a person's does", () => {
  // `gh` runs as the owner's account, so the reply has the owner's login and the marker.
  const own = comment('eggdev', `Fixed.\n\n${replyMarker}`, 4);
  expect(planOf(fixRounds(3), { comments: [own] }).ownerNow).toHaveLength(1);
  const typed = comment('eggdev', 'Try a mock.', 2);
  expect(planOf(fixRounds(3), { comments: [typed] }).ownerNow).toEqual([]);
  const other = comment('reviewer', `Quoting: ${replyMarker}`, 2);
  expect(planOf(fixRounds(3), { comments: [other] }).ownerNow).toEqual([]);
  expect(planOf(fixRounds(3), { comments: [own], viewer: undefined }).ownerNow).toHaveLength(1);
});

test('a push where the check was green starts its count again', () => {
  // unit failed twice, a fix made it pass, then lint failed alone, then unit failed again.
  const rounds = [round(1), round(2), round(3, ['lint']), round(4), round(5)];
  expect(planOf(rounds).ownerNow).toEqual([]);
  expect(planOf([...rounds, round(6)]).ownerNow.map((c) => c.fixes.length)).toEqual([3]);
});

test('two checks that fail in turn never reach the cap', () => {
  const rounds = [1, 2, 3, 4, 5, 6].map((n) => round(n, [n % 2 ? 'unit' : 'lint']));
  expect(planOf(rounds, { failed: [unit, lint] }).ownerNow).toEqual([]);
  const both = fixRounds(3).map((r) => round(Number(r.pushed?.[3]), ['unit', 'lint']));
  expect(planOf(both, { failed: [unit, lint] }).ownerNow.map((c) => c.name)).toEqual([
    'unit',
    'lint',
  ]);
});

test('a round that pushed nothing is no fix, and its test reaches the owner', () => {
  const [item] = round(3).items.map((i) => ({ ...i, decision: 'flaky' as const }));
  const rerun = round(3, [], {
    pushed: null,
    items: item ? [{ ...item, test: 'parses a date' }] : [],
  });
  const rounds = [round(1), round(2), rerun];
  expect(planOf(rounds).ownerNow).toEqual([]);
  const next = planOf([...rounds, round(4)]);
  expect(next.ownerNow[0]?.test).toBe('parses a date');
  expect(ownerEvidence(next.ownerNow)).toEqual([
    `unit needs the owner now. Failed run: ${runUrl(42)}, failing test parses a date. Fixes tried: \`fix1000\`: fix 1; \`fix2000\`: fix 2; \`fix4000\`: fix 4.`,
  ]);
});

test('a flaky rerun is recorded in the babysit log with its test', async () => {
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
  });
  expect(gh.calls).toEqual(['gh run rerun 42 --failed --repo acme/shop']);
  expect(items[0]).toMatchObject({ decision: 'flaky', test: 'parses a date' });
  const log = { version: 1 as const, answered: [], rounds: [round(1, [], { items })] };
  expect(renderLog(log)).toContain(
    `| [check unit](${runUrl(42)}) | ci | flaky | timeout | reran as flaky, test parses a date | no |`,
  );
});
