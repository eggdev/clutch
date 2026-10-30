import { expect, test } from 'bun:test';

import { nextBaseline, readBaseline, writeBaseline } from '@/doctor/baseline';
import { gitRepo } from '@/testing/git-repo';

test('the baseline sorts ids, keeps the old value for an unknown, and rises freely', () => {
  expect(
    nextBaseline(
      [
        { id: 'codeowners', status: 'present' },
        { id: 'protected_main', status: 'unknown' },
        { id: 'changed_scope_check', status: 'present' },
      ],
      { protected_main: 'present', changed_scope_check: 'partial' },
    ),
  ).toEqual({ changed_scope_check: 'present', codeowners: 'present', protected_main: 'present' });
});

test('a downgrade needs allowDowngrade', () => {
  const drop = [{ id: 'codeowners', status: 'missing' as const }];
  expect(() => nextBaseline(drop, { codeowners: 'present' })).toThrow(
    'The baseline only moves up. These would go down: codeowners present -> missing.',
  );
  expect(nextBaseline(drop, { codeowners: 'present' }, true)).toEqual({ codeowners: 'missing' });
});

test('a repository without a baseline reads as none, and a written one reads back', async () => {
  await using repo = await gitRepo({ '.clutch/.gitkeep': '' }, { git: false });
  expect(await readBaseline(repo.root)).toBeUndefined();
  await writeBaseline(repo.root, { codeowners: 'present' });
  expect(await readBaseline(repo.root)).toEqual({ codeowners: 'present' });
});
