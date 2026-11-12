import { afterEach, beforeEach, expect, test } from 'bun:test';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { checkScope } from '@tools/check-scope';

let root = '';

function git(...args: Array<string>) {
  const run = Bun.spawnSync(['git', '-C', root, ...args]);
  if (run.exitCode !== 0) {
    throw new Error(run.stderr.toString());
  }
  return run.stdout.toString().trim();
}

async function write(file: string, content: string) {
  await mkdir(path.join(root, path.dirname(file)), { recursive: true });
  await writeFile(path.join(root, file), content);
}

beforeEach(async () => {
  root = await mkdtemp(path.join(tmpdir(), 'scope-'));
  git('init', '-q', '-b', 'main');
  git('config', 'user.email', 'test@example.com');
  git('config', 'user.name', 'Test');
  await write('a.txt', 'one\n');
  git('add', '-A');
  git('commit', '-qm', 'base');
});
afterEach(() => rm(root, { recursive: true, force: true }));

const limits = { max: 5, exclude: ['gen/**'] };

test('a PR compares its own head with its own base', async () => {
  await write('b.txt', 'x\n'.repeat(6));
  git('add', '-A');
  git('commit', '-qm', 'big');
  const base = git('rev-parse', 'HEAD');
  await write('c.txt', 'y\n');
  git('add', '-A');
  git('commit', '-qm', 'small');
  expect(checkScope(root, base, limits, git('rev-parse', 'HEAD'))).toEqual([]);
});

test('a change over the limit fails, and excluded files do not count', async () => {
  await write('b.txt', 'x\n'.repeat(6));
  await write('gen/c.txt', 'x\n'.repeat(50));
  git('add', '-A');
  expect(checkScope(root, 'HEAD', limits)).toEqual([
    'The PR changes 6 lines, over the limit of 5. Split it.',
  ]);
  git('rm', '-q', '--cached', 'b.txt');
  await rm(path.join(root, 'b.txt'));
  expect(checkScope(root, 'HEAD', limits)).toEqual([]);
});

test('a new screen needs an issue that states hand_test', async () => {
  await write('KICKOFF.md', '# Kickoff\n');
  git('add', '-A');
  git('commit', '-qm', 'kickoff');
  await write('features/a/screens/x.tsx', 'x\n');
  git('add', '-A');
  expect(checkScope(root, 'HEAD', limits)[0]).toContain('hand_test');
  await write('.clutch/issues/CL-1.md', '---\nhand_test: no\n---\n');
  git('add', '-A');
  expect(checkScope(root, 'HEAD', limits)).toEqual([]);
});

test('after kickoff, a new feature needs an issue with a goal from project intent', async () => {
  await write(
    'docs/contributing/project-intent.md',
    '| Teams | Share notes with a client |\nPlain prose here.\n',
  );
  git('add', '-A');
  git('commit', '-qm', 'intent');
  await write('features/b/x.ts', 'x\n');
  git('add', '-A');
  expect(checkScope(root, 'HEAD', limits)[0]).toContain('goal:');
  await write('.clutch/issues/CL-2.md', '---\ngoal: Share notes with a client\n---\n');
  git('add', '-A');
  expect(checkScope(root, 'HEAD', limits)).toEqual([]);
  await write('.clutch/issues/CL-2.md', '---\ngoal: Win a prize\n---\n');
  git('add', '-A');
  expect(checkScope(root, 'HEAD', limits)[0]).toContain('goal:');
});

test('a hand_test line in the body of an issue does not count', async () => {
  await write('KICKOFF.md', '# Kickoff\n');
  git('add', '-A');
  git('commit', '-qm', 'kickoff');
  await write('features/a/screens/x.tsx', 'x\n');
  await write('.clutch/issues/CL-1.md', '---\nid: CL-1\n---\n\nhand_test: yes\n');
  git('add', '-A');
  const errors = checkScope(root, 'HEAD', { ...limits, max: 100 });
  expect(errors).toHaveLength(1);
  expect(errors[0]).toContain('hand_test');
});
