import { expect, test } from 'bun:test';

import { report, retry } from '@tools/run-quarantined';

const flaky = {
  file: 'tools/a.test.ts',
  name: 'slow one',
  issue: 'CL-128',
  until: '2026-11-20',
  reason: 'x',
};

test('a test is tried until it passes, at most 3 times', () => {
  const tries: Array<number> = [];
  const passOnSecond = () => {
    tries.push(tries.length + 1);
    return tries.length === 2;
  };
  expect(retry(flaky, passOnSecond)).toEqual({ test: flaky, passedOn: 2 });
  expect(tries).toEqual([1, 2]);
  expect(retry(flaky, () => false)).toEqual({ test: flaky, passedOn: null });
});

test('the report says passed, flaky on a later attempt, or failed every attempt', () => {
  const text = report([
    { test: flaky, passedOn: 1 },
    { test: { ...flaky, name: 'second' }, passedOn: 3 },
    { test: { ...flaky, name: 'third' }, passedOn: null },
  ]);
  expect(text.split('\n').slice(-3)).toEqual([
    '| tools/a.test.ts | slow one | CL-128 | 2026-11-20 | passed |',
    '| tools/a.test.ts | second | CL-128 | 2026-11-20 | flaky: passed on attempt 3 |',
    '| tools/a.test.ts | third | CL-128 | 2026-11-20 | failed all 3 attempts |',
  ]);
  expect(report([])).toBe('No test is quarantined.');
});
