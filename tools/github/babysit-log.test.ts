import { expect, test } from 'bun:test';

import {
  addRound,
  emptyLog,
  fitted,
  parseLog,
  renderDisposition,
  renderLog,
} from '@tools/github/babysit-log';
import type { Item, Round } from '@tools/github/babysit-log';

const now = '2026-11-04T12:00:00Z';

const round = (fields: Partial<Round> = {}): Round => ({
  at: now,
  run: 'https://x/run/1',
  event: 'schedule',
  triggers: ['open-thread'],
  head: 'abc1234def',
  sync: 'none',
  items: [],
  pushed: null,
  cost: { usd: 0.01, models: ['claude-haiku-5-5'] },
  outcome: 'done',
  note: '',
  ...fields,
});

test('the log survives its own comment, also with text that would close it', () => {
  const log = addRound(emptyLog(), round({ note: 'a --> b' }), [5, 5]);
  const parsed = parseLog(`intro\n${renderLog(log)}`);
  expect(parsed.answered).toEqual([5]);
  expect(parsed.rounds[0]?.note).toBe('a --> b');
  expect(parseLog('no log here')).toEqual(emptyLog());
  expect(renderLog(log)).toStartWith('## Babysit log');
});

const item = (fields: Partial<Item>): Item => ({
  kind: 'thread',
  ref: 'T',
  url: '',
  author: 'github-actions',
  decision: 'no-change',
  reason: 'the caller checks it',
  action: 'no change',
  resolved: true,
  commentId: 11,
  path: 'tools/x.ts',
  finding: '**note**: rename this',
  ...fields,
});

test('the disposition answers each agent review finding the log answered, latest first', () => {
  const log = addRound(
    addRound(
      emptyLog(),
      round({
        items: [
          item({}),
          item({
            commentId: 12,
            finding: 'blocking: docs',
            decision: 'must-fix',
            action: 'fixed in abc1234',
          }),
        ],
      }),
      [],
    ),
    round({
      items: [
        item({
          commentId: 13,
          finding: 'owner: weaker check',
          decision: 'owner',
          reason: 'the owner decides',
          action: 'left for the owner',
          resolved: false,
        }),
        item({ commentId: 14, finding: 'Why this name?' }),
        item({
          commentId: 15,
          finding: '**owner** (A weaker check): the budget drops',
          decision: 'recorded',
          reason: 'the task needs it',
          action: 'recorded for the weekly digest',
          resolved: true,
        }),
      ],
    }),
    [],
  );
  expect(renderDisposition(log)).toBe(
    [
      '## Review disposition',
      '',
      '- note `tools/x.ts` (11): not fixed: the caller checks it',
      '- blocking `tools/x.ts` (12): fixed in abc1234',
      '- owner `tools/x.ts` (13): waits for the owner: the owner decides',
      '- owner `tools/x.ts` (15): recorded for the weekly digest: the task needs it',
      '',
    ].join('\n'),
  );
  expect(renderDisposition(emptyLog())).toBeNull();
});

test('the log drops its oldest rounds to stay inside a comment', () => {
  const big = round({ note: 'x'.repeat(5000) });
  let log = emptyLog();
  for (let i = 0; i < 30; i += 1) {
    log = addRound(log, { ...big, head: `h${i}` }, [i]);
  }
  const kept = fitted(log);
  expect(JSON.stringify(kept).length).toBeLessThanOrEqual(40_000);
  expect(kept.rounds.at(-1)?.head).toBe('h29');
  expect(kept.answered.length).toBe(30);
  expect(renderLog(log).length).toBeLessThan(65_536);
});
