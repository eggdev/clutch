import { expect, test } from 'bun:test';
import { mkdtemp, realpath, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { checkEnvironment } from '@tools/hooks/pre-push';

test('push checks isolate Git fixtures from the hook repository', async () => {
  const root = await mkdtemp(path.join(tmpdir(), 'hook-environment-'));
  try {
    const init = Bun.spawnSync(['git', 'init', '-q', root]);
    expect(init.exitCode).toBe(0);
    const environment = checkEnvironment({
      ...process.env,
      GIT_DIR: '/missing-hook-repository',
      GIT_WORK_TREE: '/foreign-checkout',
      GIT_INDEX_FILE: '/foreign-index',
      GIT_COMMON_DIR: '/foreign-common',
      CI: '1',
    });
    const result = Bun.spawnSync(['git', 'rev-parse', '--show-toplevel'], {
      cwd: root,
      env: environment,
    });
    expect(result.exitCode).toBe(0);
    expect(result.stdout.toString().trim()).toBe(await realpath(root));
    expect(environment.CI).toBe('1');
    expect(environment.PATH).toBe(process.env.PATH);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
