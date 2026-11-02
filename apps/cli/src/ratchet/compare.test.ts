import { expect, test } from 'bun:test';

import { compareCounts, countText, nextCounts, parseCommandCounts } from '@/ratchet/compare';
import { validateRatchets } from '@/ratchet/config';

test('a count above the baseline is a raise, and fails', () => {
  const result = compareCounts({ counts: { 'a.ts': 2 } }, { 'a.ts': 3, 'b.ts': 1 });
  expect(result.code).toBe(1);
  expect(result.raised).toEqual([
    { path: 'a.ts', from: 2, to: 3, against: 'baseline' },
    { path: 'b.ts', from: 0, to: 1, against: 'baseline' },
  ]);
});

test('a drop without an update exits 2, and passes once the update lowers the baseline', () => {
  const ratchet = { counts: { 'a.ts': 3, 'b.ts': 1 } };
  const now = { 'a.ts': 1 };
  const before = compareCounts(ratchet, now);
  expect(before.code).toBe(2);
  expect(before.dropped.map((item) => item.path)).toEqual(['a.ts', 'b.ts']);
  const updated = { counts: nextCounts(ratchet, now) };
  expect(updated.counts).toEqual({ 'a.ts': 1 });
  expect(compareCounts(updated, now).code).toBe(0);
});

test('an update cannot raise a count, or add a path', () => {
  expect(() => nextCounts({ counts: { 'a.ts': 1 } }, { 'a.ts': 2 })).toThrow(
    'A ratchet only goes down. These would go up: a.ts 1 -> 2.',
  );
  expect(() => nextCounts({ counts: {} }, { 'new.ts': 1 })).toThrow('new.ts 0 -> 1');
});

test('a touched file may not gain a violation against the merge base, under the baseline too', () => {
  const result = compareCounts(
    { counts: { 'a.ts': 3 } },
    { 'a.ts': 2 },
    { counts: { 'a.ts': 1 }, touched: ['a.ts'] },
  );
  expect(result.raised).toEqual([{ path: 'a.ts', from: 1, to: 2, against: 'base' }]);
  expect(result.code).toBe(1);
});

test('counts come from a pattern, or from path:count lines', () => {
  expect(countText('// HACK a\nx\n// HACK b', 'HACK')).toBe(2);
  expect(parseCommandCounts('src/a.ts:2\nsrc/b.ts:0\nnoise\nsrc/a.ts:1\n')).toEqual({
    'src/a.ts': 3,
  });
});

test('the ratchets file needs one of pattern and command, a glob and positive counts', () => {
  expect(validateRatchets({ schemaVersion: 1, ratchets: {} })).toEqual([]);
  expect(
    validateRatchets({
      schemaVersion: 1,
      ratchets: {
        'Bad Name': { pattern: 'x', command: 'y', files: '', counts: { 'a.ts': 0 } },
        broken: { pattern: '(', files: '**/*.ts', counts: {} },
      },
    }),
  ).toEqual([
    'Bad Name: a name is lowercase words joined by hyphens.',
    'Bad Name: give exactly one of pattern and command.',
    'Bad Name: files is a glob, such as "src/**/*.ts".',
    'Bad Name: counts maps each path to a whole number above 0.',
    'broken: pattern is not a valid regular expression.',
  ]);
  expect(validateRatchets({ ratchets: {} })).toEqual([
    'Expected { "schemaVersion": 1, "ratchets": { ... } }.',
  ]);
});
