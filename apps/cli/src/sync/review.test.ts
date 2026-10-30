import { expect, test } from 'bun:test';
import { createHash } from 'node:crypto';
import { mkdir, readFile, readlink, symlink } from 'node:fs/promises';
import path from 'node:path';

import { gitOrThrow as git } from '@/git';
import { syncCommand } from '@/sync-command';
import { runSync } from '@/sync/run';
import { lineagePath } from '@/sync/source';
import { gitRepo } from '@/testing/git-repo';

const hash = (body: string) => createHash('sha256').update('100644\0').update(body).digest('hex');

const list = (deliverPath = '.agents/skills/deliver/') =>
  [
    'version: 1',
    'files:',
    `  - path: ${deliverPath}`,
    '    rule: managed',
    '    group: review',
    '  - path: .claude/skills/deliver',
    '    rule: managed',
    '    group: review',
    '  - path: tools/verification/',
    '    rule: managed',
    '    group: review',
    'retired:',
    '  - .agents/skills/audit/',
    'known:',
    `  .agents/skills/deliver/SKILL.md: ${hash('old shared delivery\n')}`,
    `  .agents/skills/audit/SKILL.md: ${hash('old audit\n')}`,
  ].join('\n');

/** A Clutch checkout with shared review tooling, a template-only verify and a skill link. */
async function source() {
  const repo = await gitRepo({
    'clutch.files.yaml': list(),
    '.agents/skills/deliver/SKILL.md': 'new shared delivery\n',
    '.agents/skills/verify/SKILL.md': 'verification for template source only\n',
    'tools/verification/verify.py': 'print("fixture runner")\n',
  });
  await mkdir(path.join(repo.root, '.claude/skills'), { recursive: true });
  await symlink('../../.agents/skills/deliver', path.join(repo.root, '.claude/skills/deliver'));
  await git(repo.root, 'add', '--all');
  await git(repo.root, 'commit', '-qm', 'Publish review fixtures');
  return repo;
}

const review = (root: string, template: string, check?: boolean) =>
  runSync({ root, template, only: 'review', check });

test('sync --only review distributes shared tooling, preserves project verify and repeats without changes', async () => {
  await using template = await source();
  await using project = await gitRepo({
    'package.json': '{"name":"shop"}',
    '.agents/skills/verify/SKILL.md': 'Shop assertions\n',
  });
  const head = await git(project.root, 'rev-parse', 'HEAD');
  const output: Array<string> = [];
  const { log } = console;
  console.log = (line: string) => output.push(line);
  try {
    expect(await syncCommand(['--only', 'review'], project.root, template.root)).toBe(0);
  } finally {
    console.log = log;
  }
  expect(output.at(-1)).toContain('Use setup-verification');
  expect(await readFile(path.join(project.root, '.agents/skills/verify/SKILL.md'), 'utf-8')).toBe(
    'Shop assertions\n',
  );
  expect(await readlink(path.join(project.root, '.claude/skills/deliver'))).toBe(
    '../../.agents/skills/deliver',
  );
  expect(await readFile(path.join(project.root, 'tools/verification/verify.py'), 'utf-8')).toBe(
    'print("fixture runner")\n',
  );
  const again = await review(project.root, template.root);
  expect(again.status).toBe('unchanged');
  expect(await git(project.root, 'rev-parse', 'HEAD')).toBe(head);
});

test('customized shared files stop the whole sync before writing any other files', async () => {
  await using template = await source();
  await using project = await gitRepo({
    'package.json': '{}',
    '.agents/skills/deliver/SKILL.md': 'Project-specific changes\n',
  });
  const result = await review(project.root, template.root);
  expect(result.status).toBe('decisions');
  expect(result.decisions).toContain('.agents/skills/deliver/SKILL.md');
  expect(await Bun.file(path.join(project.root, 'tools/verification/verify.py')).exists()).toBe(
    false,
  );
  expect(await Bun.file(path.join(project.root, lineagePath)).exists()).toBe(false);
  expect(await git(project.root, 'status', '--porcelain')).toBe('');
});

test('known unchanged older copies can migrate and retired skills are removed safely', async () => {
  await using template = await source();
  await using project = await gitRepo({
    'package.json': '{}',
    '.agents/skills/deliver/SKILL.md': 'old shared delivery\n',
    '.agents/skills/audit/SKILL.md': 'old audit\n',
  });
  const result = await review(project.root, template.root);
  expect(result.status).toBe('synced');
  expect(await readFile(path.join(project.root, '.agents/skills/deliver/SKILL.md'), 'utf-8')).toBe(
    'new shared delivery\n',
  );
  expect(await Bun.file(path.join(project.root, '.agents/skills/audit/SKILL.md')).exists()).toBe(
    false,
  );
});

test('recorded checksums permit updates but protect later project customization', async () => {
  await using template = await source();
  await using project = await gitRepo({ 'package.json': '{}' });
  await review(project.root, template.root);
  await git(project.root, 'add', '--all');
  await git(project.root, 'commit', '-qm', 'Sync review tooling');
  await template.write({ '.agents/skills/deliver/SKILL.md': 'version two\n' });
  await git(template.root, 'commit', '-qam', 'Update shared skill');
  const second = await review(project.root, template.root);
  expect(second.status).toBe('synced');
  await project.write({ '.agents/skills/deliver/SKILL.md': 'Customized version two\n' });
  await git(project.root, 'add', '--all');
  await git(project.root, 'commit', '-qm', 'Customize skill');
  await template.write({ '.agents/skills/deliver/SKILL.md': 'version three\n' });
  await git(template.root, 'commit', '-qam', 'Update again');
  const third = await review(project.root, template.root);
  expect(third.status).toBe('decisions');
  expect(await readFile(path.join(project.root, '.agents/skills/deliver/SKILL.md'), 'utf-8')).toBe(
    'Customized version two\n',
  );
});

test('check is read-only and a real sync refuses dirty review tooling', async () => {
  await using template = await source();
  await using project = await gitRepo({ 'package.json': '{}' });
  await project.write({ 'tools/verification/verify.py': 'print("fixture runner")\n' });
  const checked = await review(project.root, template.root, true);
  expect(checked.status).toBe('planned');
  await expect(review(project.root, template.root)).rejects.toThrow('Commit or stash');
  expect(await Bun.file(path.join(project.root, lineagePath)).exists()).toBe(false);
});

test('a sync leaves unrelated dirty work in place', async () => {
  await using template = await source();
  await using project = await gitRepo({ 'package.json': '{}', 'app.ts': 'committed\n' });
  await project.write({ 'app.ts': 'active work\n', 'notes.txt': 'untracked work\n' });
  const result = await review(project.root, template.root);
  expect(result.status).toBe('synced');
  expect(await readFile(path.join(project.root, 'app.ts'), 'utf-8')).toBe('active work\n');
  expect(await readFile(path.join(project.root, 'notes.txt'), 'utf-8')).toBe('untracked work\n');
});

test('symlinked target directories cannot redirect writes outside the project', async () => {
  await using template = await source();
  await using project = await gitRepo({ 'package.json': '{}' });
  await mkdir(path.join(project.parent, 'foreign'));
  await symlink(path.join(project.parent, 'foreign'), path.join(project.root, '.clutch'));
  await expect(review(project.root, template.root)).rejects.toThrow('Symlinked parent');
  expect(await Bun.file(path.join(project.parent, 'foreign/lineage.json')).exists()).toBe(false);
});

test('a partially copied generation converges and custom retired skills remain untouched', async () => {
  await using template = await source();
  await using project = await gitRepo({
    'package.json': '{}',
    '.agents/skills/deliver/SKILL.md': 'new shared delivery\n',
    '.agents/skills/audit/SKILL.md': 'Customized old audit\n',
  });
  const first = await review(project.root, template.root);
  expect(first.decisions).toContain('.agents/skills/audit/SKILL.md');
  await git(project.root, 'rm', '.agents/skills/audit/SKILL.md');
  await git(project.root, 'commit', '-qm', 'Remove reviewed legacy skill');
  const second = await review(project.root, template.root);
  expect(second.status).toBe('synced');
});

test('an overbroad source list cannot distribute the template-specific verify', async () => {
  await using template = await source();
  await template.write({ 'clutch.files.yaml': list('.agents/skills/') });
  await git(template.root, 'commit', '-qam', 'Accidental broad export');
  await using project = await gitRepo({ 'package.json': '{}' });
  await expect(review(project.root, template.root)).rejects.toThrow('must be generated');
});

test('a sync removes the old .review/tooling.json once the lineage holds its record', async () => {
  await using template = await source();
  await using project = await gitRepo({
    'package.json': '{}',
    '.review/tooling.json': JSON.stringify({ schemaVersion: 1, templateCommit: '', files: {} }),
  });
  const result = await review(project.root, template.root);
  expect(result.changes).toContainEqual({ path: '.review/tooling.json', action: 'remove' });
  expect(await Bun.file(path.join(project.root, '.review/tooling.json')).exists()).toBe(false);
  expect(await Bun.file(path.join(project.root, lineagePath)).exists()).toBe(true);
});
