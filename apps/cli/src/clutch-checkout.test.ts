import { expect, test } from 'bun:test';
import path from 'node:path';

import { cacheFolder, cachedClone } from '@/clutch-checkout';
import { gitOrThrow as git } from '@/git';
import { latestRelease } from '@/release';
import { gitRepo } from '@/testing/git-repo';

test('the cache folder follows XDG_CACHE_HOME', () => {
  expect(cacheFolder({ XDG_CACHE_HOME: '/c' })).toBe('/c/clutch');
  expect(cacheFolder({ HOME: '/h' })).toEndWith('/.cache/clutch');
});

test('a cached clone starts bare, and each run fetches the new releases', async () => {
  await using upstream = await gitRepo({ 'clutch.files.yaml': 'version: 1\nfiles: []\n' });
  await git(upstream.root, 'tag', 'v0.1.0');
  const folder = path.join(upstream.parent, 'cache', 'eggdev__clutch.git');

  expect(await cachedClone(upstream.root, folder)).toBe(folder);
  expect(await git(folder, 'rev-parse', '--is-bare-repository')).toBe('true');
  expect(await latestRelease(folder)).toBe('v0.1.0');

  await git(upstream.root, 'commit', '--quiet', '--allow-empty', '--message', 'Next');
  await git(upstream.root, 'tag', 'v0.2.0');
  await cachedClone(upstream.root, folder);
  expect(await latestRelease(folder)).toBe('v0.2.0');
  expect(await git(folder, 'rev-parse', 'v0.2.0^{commit}')).toBe(
    await git(upstream.root, 'rev-parse', 'HEAD'),
  );
});
