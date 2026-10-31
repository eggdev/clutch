import { expect, test } from 'bun:test';

import { codeownersDefault, verdictOwner } from '@/metrics/owner';
import { gitRepo } from '@/testing/git-repo';

test('the CODEOWNERS default is the * owner, else the person named most', () => {
  expect(codeownersDefault('/docs/ @ann\n* @bob @acme/team\n/a @ann\n')).toBe('bob');
  expect(codeownersDefault('# owners\n/a @ann\n/b @ann @cy\n/c @acme/team\n')).toBe('ann');
  expect(codeownersDefault('/c @acme/team\n')).toBeUndefined();
});

/** A clutch.yaml whose automerge block ends with `extra`. */
const config = (extra: string) =>
  `schemaVersion: 1\nproject: shop\ntemplate: { repo: eggdev/clutch, mode: sync }\ncapabilities: {}\nautomerge: { mode: dry-run${extra} }\n`;

test('the owner comes from the flag, then clutch.yaml, then CODEOWNERS', async () => {
  await using repo = await gitRepo({
    '.github/CODEOWNERS': '/tools/ @ann\n',
    'clutch.yaml': config(''),
  });
  expect(await verdictOwner(repo.root)).toBe('ann');
  await repo.write({ 'clutch.yaml': config(', owner: bob') });
  expect(await verdictOwner(repo.root)).toBe('bob');
  expect(await verdictOwner(repo.root, '@cy')).toBe('cy');
  await using bare = await gitRepo({});
  expect(await verdictOwner(bare.root)).toBeNull();
});
