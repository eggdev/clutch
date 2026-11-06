import { expect, test } from 'bun:test';

import { enableAutoMerge } from '@tools/github/auto-merge';
import { fake, head } from '@tools/github/auto-merge-fake';

const stacked =
  'GraphQL: This pull request is part of a stack and must be merged using the asynchronous merge REST API.';

test('a stacked PR merges through the asynchronous merge API, only at the judged head', async () => {
  const gh = fake([['gh pr merge', { ok: false, err: stacked }]]);
  await enableAutoMerge(gh.run, 'eggdev/clutch', '7', head, 'medium');
  expect(gh.calls.filter((call) => call.startsWith('gh api --method PUT'))).toEqual([
    `gh api --method PUT repos/eggdev/clutch/pulls/7/merge-async -f merge_method=merge -f sha=${head}`,
  ]);
});

test('a PR outside a stack queues auto-merge and never calls the asynchronous merge API', async () => {
  const gh = fake();
  await enableAutoMerge(gh.run, 'eggdev/clutch', '7', head, 'medium');
  expect(gh.calls.some((call) => call.includes('merge-async'))).toBe(false);
  expect(gh.calls).toContain(`gh pr merge 7 --auto --merge --match-head-commit ${head}`);
});

test('any other refusal fails the merge, so the run shows it', async () => {
  const gh = fake([['gh pr merge', { ok: false, err: 'Pull request is not mergeable' }]]);
  await expect(enableAutoMerge(gh.run, 'eggdev/clutch', '7', head, 'medium')).rejects.toThrow(
    'Pull request is not mergeable',
  );
  expect(gh.calls.some((call) => call.includes('merge-async'))).toBe(false);
});
