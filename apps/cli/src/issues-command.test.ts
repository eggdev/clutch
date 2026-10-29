import { expect, test } from 'bun:test';
import { readFile } from 'node:fs/promises';
import path from 'node:path';

import { gitRepo } from '@/testing/git-repo';

const main = path.join(import.meta.dir, 'main.ts');

const issueFile = (id: string, status: string, dependsOn: string) =>
  `---\nid: ${id}\ntitle: 'Issue ${id}'\nphase: P0\nstatus: ${status}\ndepends_on: [${dependsOn}]\npr: ''\nowner: agent\n---\n\n# ${id}: Issue ${id}\n`;

async function clutch(root: string, ...args: Array<string>) {
  const proc = Bun.spawn([process.execPath, main, 'issues', ...args], {
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

function tracker() {
  return gitRepo({
    '.clutch/issues/CL-001.md': issueFile('CL-001', 'done', ''),
    '.clutch/issues/CL-002.md': issueFile('CL-002', 'review', 'CL-001'),
    '.clutch/issues/CL-003.md': issueFile('CL-003', 'todo', 'CL-002'),
  });
}

test('--check fails until --write renders the tracker, then passes', async () => {
  await using repo = await tracker();
  expect(await clutch(repo.root, '--check')).toMatchObject({ code: 2 });
  expect(await clutch(repo.root, '--write')).toMatchObject({ code: 0 });
  expect(await clutch(repo.root, '--check')).toMatchObject({ code: 0 });
  const written = await readFile(path.join(repo.root, '.clutch/TRACKER.md'), 'utf-8');
  expect(written).toContain('| CL-002 | Issue CL-002 | review | CL-001     |     | agent |');
});

test('a bad frontmatter value makes --check exit 1 and name the file and field', async () => {
  await using repo = await tracker();
  await repo.write({ '.clutch/issues/CL-003.md': issueFile('CL-003', 'started', 'CL-002') });
  const result = await clutch(repo.root, '--check');
  expect(result.code).toBe(1);
  expect(result.stderr).toContain('.clutch/issues/CL-003.md: status: Expected one of');
});

test('next waits for review dependencies unless --stack, and set updates the file and tracker', async () => {
  await using repo = await tracker();
  expect(await clutch(repo.root, 'next')).toMatchObject({
    code: 1,
    stdout: 'No unblocked issue.\n',
  });
  const stacked = await clutch(repo.root, 'next', '--stack', '--json');
  const { issue } = JSON.parse(stacked.stdout);
  expect(issue.id).toBe('CL-003');

  const url = 'https://github.com/o/r/pull/2';
  expect(await clutch(repo.root, 'set', 'CL-002', 'done', '--pr', url)).toMatchObject({ code: 0 });
  const file = await readFile(path.join(repo.root, '.clutch/issues/CL-002.md'), 'utf-8');
  expect(file).toBe(
    `---\nid: CL-002\ntitle: 'Issue CL-002'\nphase: P0\nstatus: done\ndepends_on: [CL-001]\npr: '${url}'\nowner: agent\n---\n\n# CL-002: Issue CL-002\n`,
  );
  expect(await clutch(repo.root, '--check')).toMatchObject({ code: 0 });
  expect(await clutch(repo.root, 'next')).toMatchObject({
    stdout: expect.stringContaining('CL-003'),
  });
});

test('set refuses an unknown status and an unknown issue', async () => {
  await using repo = await tracker();
  expect(await clutch(repo.root, 'set', 'CL-002', 'shipped')).toMatchObject({ code: 1 });
  expect(await clutch(repo.root, 'set', 'CL-009', 'done')).toMatchObject({
    stderr: expect.stringContaining('No issue CL-009'),
  });
});
