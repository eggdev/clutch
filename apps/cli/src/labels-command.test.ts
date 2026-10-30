import { expect, test } from 'bun:test';
import path from 'node:path';

import { gitOrThrow } from '@/git';
import { gitRepo } from '@/testing/git-repo';

const main = path.join(import.meta.dir, 'main.ts');

async function clutchLabels(root: string, ...args: Array<string>) {
  const proc = Bun.spawn([process.execPath, main, 'labels', ...args], {
    cwd: root,
    stdout: 'pipe',
    stderr: 'pipe',
  });
  const [stdout, code] = await Promise.all([new Response(proc.stdout).text(), proc.exited]);
  return { stdout, code };
}

const lines = (count: number) =>
  `${Array.from({ length: count }, (_, i) => `line ${i}`).join('\n')}\n`;

test('a large change gets size/XL and a warning, and still exits 0', async () => {
  await using repo = await gitRepo({
    'package.json': JSON.stringify({ name: 'shop', workspaces: ['apps/*'] }),
  });
  await gitOrThrow(repo.root, 'switch', '--quiet', '--create', 'change');
  await repo.write({
    'apps/web/page.ts': lines(900),
    'bun.lock': lines(5000),
    'docs/a.md': lines(2),
  });
  await gitOrThrow(repo.root, 'add', '--all');
  await gitOrThrow(repo.root, 'commit', '--quiet', '--message', 'Change');
  const result = await clutchLabels(repo.root, '--base', 'main', '--title=feat(web): x', '--json');
  expect(result.code).toBe(0);
  const out = JSON.parse(result.stdout);
  expect(out.apply.map((label: { name: string }) => label.name)).toEqual([
    'kind/feat',
    'area/docs',
    'area/root',
    'area/web',
    'size/XL',
  ]);
  expect(out.size).toMatchObject({ lines: 902, warn: 300 });
  expect(out.size.warning).toContain('902 changed lines');
});

test('pr_size in clutch.yaml raises the warning threshold', async () => {
  await using repo = await gitRepo({
    'clutch.yaml':
      'schemaVersion: 1\nproject: shop\ntemplate:\n  repo: acme/clutch\n  mode: sync\ncapabilities: {}\npr_size:\n  warn: 1000\n',
  });
  await gitOrThrow(repo.root, 'switch', '--quiet', '--create', 'change');
  await repo.write({ 'src/a.ts': lines(900) });
  await gitOrThrow(repo.root, 'add', '--all');
  await gitOrThrow(repo.root, 'commit', '--quiet', '--message', 'Change');
  const result = await clutchLabels(repo.root, '--base', 'main');
  expect(result.stdout).toBe('area/src\nsize/XL\n');
});
