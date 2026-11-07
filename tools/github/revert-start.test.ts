import { expect, test } from 'bun:test';

import { fake, fakeClock } from '@tools/github/fake-run';
import { revert } from '@tools/github/revert-start';

const timing = { timeout: 60_000, interval: 15_000 };
const prs = (items: Array<{ number: number; state: string }>) => ({
  out: JSON.stringify(
    items.map((item) => ({ ...item, url: `https://github.com/acme/shop/pull/${item.number}` })),
  ),
});

test('a revert reports the new revert PR, never an older closed one', async () => {
  const gh = fake([
    ['gh repo view', { out: 'main\n' }],
    [
      'gh pr list --state all --head revert/42',
      [
        prs([{ number: 50, state: 'CLOSED' }]),
        prs([{ number: 50, state: 'CLOSED' }]),
        prs([
          { number: 61, state: 'OPEN' },
          { number: 50, state: 'CLOSED' },
        ]),
      ],
    ],
  ]);
  expect(await revert(gh.run, '42', fakeClock(), timing)).toBe(0);
  expect(gh.calls).toContain('gh workflow run revert.yml --ref main -f pr=42');
});

test('an open revert PR is reported, and no second revert starts', async () => {
  const gh = fake([
    ['gh repo view', { out: 'main\n' }],
    ['gh pr list --state all --head revert/42', prs([{ number: 61, state: 'OPEN' }])],
  ]);
  expect(await revert(gh.run, '42', fakeClock(), timing)).toBe(0);
  expect(gh.calls.some((call) => call.startsWith('gh workflow run'))).toBe(false);
});
