import { expect, test } from 'bun:test';

import { fake } from '@tools/github/fake-run';
import { isRed, latestChecks, requiredChecks } from '@tools/github/main-checks';

test('the required checks are the rules of the branch, plus agent review once', async () => {
  const gh = fake([
    ['gh api repos/acme/shop/rules/branches/main', { out: '["validate","agent-review"]' }],
  ]);
  expect(await requiredChecks(gh.run, 'acme/shop', 'main')).toEqual(['validate', 'agent-review']);
  const bare = fake([['gh api repos/acme/shop/rules/branches/main', { out: '["validate"]' }]]);
  expect(await requiredChecks(bare.run, 'acme/shop', 'main')).toEqual(['validate', 'agent-review']);
});

/** The job lines that the Actions jobs API gives, one JSON object per line. */
const jobs = (...rows: Array<[number, string, string, string | null]>) =>
  rows
    .map(([id, name, status, conclusion]) => JSON.stringify({ id, name, status, conclusion }))
    .join('\n');

test('the latest job of each check on the push runs of the commit counts', async () => {
  const gh = fake([
    ['gh api --paginate repos/acme/shop/actions/runs?head_sha=red1234', { out: '7\n8\n' }],
    [
      'gh api --paginate repos/acme/shop/actions/runs/7/jobs',
      {
        out: jobs(
          [11, 'validate', 'completed', 'failure'],
          [12, 'production', 'completed', 'failure'],
        ),
      },
    ],
    [
      'gh api --paginate repos/acme/shop/actions/runs/8/jobs',
      {
        out: jobs(
          [20, 'validate', 'completed', 'success'],
          [10, 'validate', 'completed', 'failure'],
          [21, 'agent-review', 'in_progress', null],
        ),
      },
    ],
  ]);
  const checks = await latestChecks(gh.run, 'acme/shop', 'main', 'red1234');
  expect(checks.get('validate')).toEqual({ status: 'completed', conclusion: 'success' });
  expect(checks.get('production')).toEqual({ status: 'completed', conclusion: 'failure' });
  expect(checks.get('agent-review')).toEqual({ status: 'in_progress', conclusion: null });
  expect(checks.has('missing')).toBe(false);
});

test('a check is red only once it completes with a failing conclusion', () => {
  expect(isRed({ status: 'completed', conclusion: 'failure' })).toBe(true);
  expect(isRed({ status: 'completed', conclusion: 'timed_out' })).toBe(true);
  expect(isRed({ status: 'completed', conclusion: 'success' })).toBe(false);
  expect(isRed({ status: 'completed', conclusion: 'skipped' })).toBe(false);
  expect(isRed({ status: 'in_progress', conclusion: null })).toBe(false);
});
