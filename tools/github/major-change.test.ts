import { expect, test } from 'bun:test';

import { fake } from '@tools/github/fake-run';
import { majorChange } from '@tools/github/major-change';

const title = 'gh api repos/eggdev/clutch/pulls/7 --jq .title';
const files = 'gh api --paginate repos/eggdev/clutch/pulls/7/files';

/** Pull request 7 with the title `headline` and the changed files `changed`, as `gh` answers them. */
const pr = (headline: string, ...changed: Array<{ filename: string; patch?: string }>) =>
  fake([
    [title, { out: `${headline}\n` }],
    [files, { out: changed.map((file) => JSON.stringify(file)).join('\n') }],
  ]);

const bangReason = 'its title has "!" before the colon';

test('a feat! title is a major change', async () => {
  expect(await majorChange(pr('feat!: drop the old flag').run, 'eggdev/clutch', '7')).toEqual([
    bangReason,
  ]);
});

test('a fix(cli)! title is a major change', async () => {
  expect(await majorChange(pr('fix(cli)!: rename a command').run, 'eggdev/clutch', '7')).toEqual([
    bangReason,
  ]);
});

test('a feat title with no changeset is not a major change', async () => {
  expect(await majorChange(pr('feat: add a flag').run, 'eggdev/clutch', '7')).toEqual([]);
});

test('a changeset that adds a major bump is a major change, and the reason names the file', async () => {
  const major = pr('fix: a small change', {
    filename: '.changeset/big-change.md',
    patch: "@@ -1,3 +1,3 @@\n+'clutch': major\n",
  });
  expect(await majorChange(major.run, 'eggdev/clutch', '7')).toEqual([
    'the changeset .changeset/big-change.md names a major bump',
  ]);
});

test('a changeset that adds a minor bump is not a major change', async () => {
  const minor = pr('feat: add a flag', {
    filename: '.changeset/small-change.md',
    patch: "@@ -1,3 +1,3 @@\n+'clutch': minor\n",
  });
  expect(await majorChange(minor.run, 'eggdev/clutch', '7')).toEqual([]);
});

test('a changeset that only removes a major bump is not a major change', async () => {
  const removed = pr('fix: a small change', {
    filename: '.changeset/old-change.md',
    patch: "@@ -1,3 +1,3 @@\n-'clutch': major\n+'clutch': patch\n",
  });
  expect(await majorChange(removed.run, 'eggdev/clutch', '7')).toEqual([]);
});
