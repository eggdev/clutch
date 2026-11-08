import { expect, test } from 'bun:test';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { babysit } from '@tools/github/babysit-session';
import { fake } from '@tools/github/fake-run';

test('the apply step refuses a round that the plan capped, and points to --stuck', async () => {
  const gitDir = await mkdtemp(path.join(tmpdir(), 'babysit-session-'));
  try {
    await mkdir(path.join(gitDir, 'clutch'), { recursive: true });
    await writeFile(
      path.join(gitDir, 'clutch', 'babysit-7.json'),
      JSON.stringify({
        number: 7,
        head: 'h3ad',
        skip: '2 rounds on h3ad already met the same work: open-thread',
      }),
    );
    const gh = fake([
      ['gh repo view', { out: 'acme/shop\n' }],
      ['git rev-parse --absolute-git-dir', { out: `${gitDir}\n` }],
    ]);
    await expect(
      babysit(gh.run, '7', { answers: '/nonexistent.json', now: '2026-11-06T10:00:00Z' }),
    ).rejects.toThrow('No round for #7: 2 rounds on h3ad already met the same work');
    expect(gh.calls.some((call) => call.startsWith('gh api'))).toBe(false);
  } finally {
    await rm(gitDir, { recursive: true, force: true });
  }
});
