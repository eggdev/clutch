import { expect, test } from 'bun:test';

import type { ChangedFile } from '@tools/github/bot-rule';
import { fake } from '@tools/github/fake-run';
import { majorChange } from '@tools/github/major-change';

/** Whether pull request 7, with the title `headline` and the changed files `changed`, is a major change. */
const majorOf = (headline: string, ...changed: Array<ChangedFile>) =>
  majorChange(
    fake([['gh api repos/eggdev/clutch/pulls/7 --jq .title', { out: `${headline}\n` }]]).run,
    'eggdev/clutch',
    '7',
    changed,
  );

const bangReason = 'its title has "!" before the colon';

test('a feat! title is a major change', async () => {
  expect(await majorOf('feat!: drop the old flag')).toEqual([bangReason]);
});

test('a fix(cli)! title is a major change', async () => {
  expect(await majorOf('fix(cli)!: rename a command')).toEqual([bangReason]);
});

test('a feat title with no changeset is not a major change', async () => {
  expect(await majorOf('feat: add a flag')).toEqual([]);
});

test('a changeset that adds a major bump is a major change, and the reason names the file', async () => {
  const changeset = {
    filename: '.changeset/big-change.md',
    patch: "@@ -1,3 +1,3 @@\n+'clutch': major\n",
  };
  expect(await majorOf('fix: a small change', changeset)).toEqual([
    'the changeset .changeset/big-change.md names a major bump',
  ]);
});

test('a changeset that adds a minor bump is not a major change', async () => {
  const changeset = {
    filename: '.changeset/small-change.md',
    patch: "@@ -1,3 +1,3 @@\n+'clutch': minor\n",
  };
  expect(await majorOf('feat: add a flag', changeset)).toEqual([]);
});

test('a changeset that only removes a major bump is not a major change', async () => {
  const changeset = {
    filename: '.changeset/old-change.md',
    patch: "@@ -1,3 +1,3 @@\n-'clutch': major\n+'clutch': patch\n",
  };
  expect(await majorOf('fix: a small change', changeset)).toEqual([]);
});

test('a major line in a file outside .changeset is not a major change', async () => {
  const other = { filename: 'docs/notes.md', patch: "@@ -1 +1 @@\n+'clutch': major\n" };
  expect(await majorOf('fix: a small change', other)).toEqual([]);
});
