import { expect, test } from 'bun:test';
import path from 'node:path';

import { gitRepo } from '@/testing/git-repo';

const main = path.join(import.meta.dir, 'main.ts');

async function clutchChecks(root: string, ...args: Array<string>) {
  const proc = Bun.spawn([process.execPath, main, 'checks', ...args], {
    cwd: root,
    stdout: 'pipe',
    stderr: 'pipe',
  });
  const [stdout, stderr, code] = await Promise.all([
    new Response(proc.stdout).text(),
    new Response(proc.stderr).text(),
    proc.exited,
  ]);
  return { stdout, stderr, code };
}

test('checks --changed runs the project tools/validate.ts with its base', async () => {
  // A stand-in validate that prints its arguments and exits with 3.
  await using repo = await gitRepo({
    'tools/validate.ts': 'console.log(JSON.stringify(process.argv.slice(2)));\nprocess.exit(3);\n',
  });
  const result = await clutchChecks(repo.root, '--changed', '--base', 'origin/main');
  expect(result.stdout.trim()).toBe('["--changed","--base","origin/main"]');
  expect(result.code).toBe(3);
});

test('checks needs --changed, and a project with tools/validate.ts', async () => {
  await using repo = await gitRepo({ 'README.md': '# x\n' });
  expect(await clutchChecks(repo.root)).toMatchObject({ code: 1 });
  const missing = await clutchChecks(repo.root, '--changed');
  expect(missing.code).toBe(1);
  expect(missing.stderr).toContain('has no tools/validate.ts');
});
