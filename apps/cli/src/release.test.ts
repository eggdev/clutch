import { expect, test } from 'bun:test';

import { gitOrThrow as git } from '@/git';
import { latestRelease, newestRelease, releaseAt } from '@/release';
import { gitRepo } from '@/testing/git-repo';

test('the newest release compares versions as numbers and skips other tags', () => {
  expect(newestRelease(['v0.9.0', 'v0.10.0', 'v0.10.0-rc.1', 'v1', 'latest', ''])).toBe('v0.10.0');
  expect(newestRelease(['v2.0.0', 'v10.0.0'])).toBe('v10.0.0');
  expect(newestRelease([])).toBeNull();
});

test('the latest release is the newest local tag, and a commit knows its release', async () => {
  await using template = await gitRepo({ 'a.txt': 'a' });
  await expect(latestRelease(template.root)).rejects.toThrow('has no Clutch release tag');
  const first = await git(template.root, 'rev-parse', 'HEAD');
  await git(template.root, 'tag', 'v0.9.0');
  await git(template.root, 'commit', '--quiet', '--allow-empty', '--message', 'next');
  await git(template.root, 'tag', 'v0.10.0');
  expect(await latestRelease(template.root)).toBe('v0.10.0');
  expect(await releaseAt(template.root, first)).toBe('v0.9.0');
  await git(template.root, 'commit', '--quiet', '--allow-empty', '--message', 'unreleased');
  expect(await releaseAt(template.root, 'HEAD')).toBeNull();
});
