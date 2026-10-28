import { expect, test } from 'bun:test';
import { createHash } from 'node:crypto';
import { mkdir, readFile, readlink, symlink } from 'node:fs/promises';
import path from 'node:path';

import { gitOrThrow as git } from '@/git';
import { installReview } from '@/review-install';
import { gitRepo } from '@/testing/git-repo';

async function source() {
  const repo = await gitRepo({
    '.agents/skills/deliver/SKILL.md': 'old shared delivery\n',
    '.agents/skills/audit/SKILL.md': 'old audit\n',
  });
  const files = Object.fromEntries(
    ['deliver', 'audit'].map((skill) => {
      const body = skill === 'deliver' ? 'old shared delivery\n' : 'old audit\n';
      return [
        `.agents/skills/${skill}/SKILL.md`,
        createHash('sha256').update('100644\0').update(body).digest('hex'),
      ];
    }),
  );
  await repo.write({
    'review-baseline.json': JSON.stringify({
      schemaVersion: 1,
      sourceCommit: 'not-present-in-shallow-history',
      files,
    }),
    'review.files.yaml':
      'baseline: review-baseline.json\nfiles:\n  - .agents/skills/deliver/\n  - .claude/skills/deliver\n  - tools/verification/\nretired:\n  - .agents/skills/audit/\n',
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

test('review install distributes shared tooling, preserves project verify and repeats without changes', async () => {
  await using template = await source();
  await using project = await gitRepo({
    'package.json': '{"name":"shop"}',
    '.agents/skills/verify/SKILL.md': 'Shop assertions\n',
  });
  const head = await git(project.root, 'rev-parse', 'HEAD');
  const first = await installReview({ root: project.root, template: template.root });
  expect(first.status).toBe('installed');
  expect(first.nextAction).toBe('setup-verification');
  expect(await readFile(path.join(project.root, '.agents/skills/verify/SKILL.md'), 'utf-8')).toBe(
    'Shop assertions\n',
  );
  expect(await readlink(path.join(project.root, '.claude/skills/deliver'))).toBe(
    '../../.agents/skills/deliver',
  );
  expect(await readFile(path.join(project.root, 'tools/verification/verify.py'), 'utf-8')).toBe(
    'print("fixture runner")\n',
  );
  const result1 = await installReview({ root: project.root, template: template.root });
  expect(result1.status).toBe('unchanged');
  expect(await git(project.root, 'rev-parse', 'HEAD')).toBe(head);
});

test('customized shared files stop the whole install before writing any other files', async () => {
  await using template = await source();
  await using project = await gitRepo({
    'package.json': '{}',
    '.agents/skills/deliver/SKILL.md': 'Project-specific changes\n',
  });
  const result = await installReview({ root: project.root, template: template.root });
  expect(result.status).toBe('conflict');
  expect(result.conflicts).toContain('.agents/skills/deliver/SKILL.md');
  expect(await Bun.file(path.join(project.root, 'tools/verification/verify.py')).exists()).toBe(
    false,
  );
  expect(await Bun.file(path.join(project.root, '.review/tooling.json')).exists()).toBe(false);
  expect(await git(project.root, 'status', '--porcelain')).toBe('');
});

test('known unchanged template files can migrate and retired skills are removed safely', async () => {
  await using template = await source();
  await using project = await gitRepo({
    'package.json': '{}',
    '.agents/skills/deliver/SKILL.md': 'old shared delivery\n',
    '.agents/skills/audit/SKILL.md': 'old audit\n',
  });
  const result2 = await installReview({ root: project.root, template: template.root });
  expect(result2.status).toBe('installed');
  expect(await readFile(path.join(project.root, '.agents/skills/deliver/SKILL.md'), 'utf-8')).toBe(
    'new shared delivery\n',
  );
  expect(await Bun.file(path.join(project.root, '.agents/skills/audit/SKILL.md')).exists()).toBe(
    false,
  );
});

test('recorded checksums permit updates but protect subsequent project customization', async () => {
  await using template = await source();
  await using project = await gitRepo({ 'package.json': '{}' });
  await installReview({ root: project.root, template: template.root });
  await git(project.root, 'add', '--all');
  await git(project.root, 'commit', '-qm', 'Install review tooling');
  await template.write({ '.agents/skills/deliver/SKILL.md': 'version two\n' });
  await git(template.root, 'commit', '-qam', 'Update shared skill');
  const result3 = await installReview({ root: project.root, template: template.root });
  expect(result3.status).toBe('installed');
  await project.write({ '.agents/skills/deliver/SKILL.md': 'Customized version two\n' });
  await git(project.root, 'add', '--all');
  await git(project.root, 'commit', '-qm', 'Customize skill');
  await template.write({ '.agents/skills/deliver/SKILL.md': 'version three\n' });
  await git(template.root, 'commit', '-qam', 'Update again');
  const result4 = await installReview({ root: project.root, template: template.root });
  expect(result4.status).toBe('conflict');
  expect(await readFile(path.join(project.root, '.agents/skills/deliver/SKILL.md'), 'utf-8')).toBe(
    'Customized version two\n',
  );
});

test('check is read-only and real installation refuses dirty review tooling', async () => {
  await using template = await source();
  await using project = await gitRepo({ 'package.json': '{}' });
  await project.write({ 'tools/verification/verify.py': 'print("fixture runner")\n' });
  const result5 = await installReview({ root: project.root, template: template.root, check: true });
  expect(result5.status).toBe('planned');
  await expect(installReview({ root: project.root, template: template.root })).rejects.toThrow(
    'Commit or stash',
  );
  expect(await Bun.file(path.join(project.root, '.review/tooling.json')).exists()).toBe(false);
});

test('installation leaves unrelated dirty work in place', async () => {
  await using template = await source();
  await using project = await gitRepo({ 'package.json': '{}', 'app.ts': 'committed\n' });
  await project.write({ 'app.ts': 'active work\n', 'notes.txt': 'untracked work\n' });
  const result = await installReview({ root: project.root, template: template.root });
  expect(result.status).toBe('installed');
  expect(await readFile(path.join(project.root, 'app.ts'), 'utf-8')).toBe('active work\n');
  expect(await readFile(path.join(project.root, 'notes.txt'), 'utf-8')).toBe('untracked work\n');
});

test('symlinked target directories cannot redirect writes outside the project', async () => {
  await using template = await source();
  await using project = await gitRepo({ 'package.json': '{}' });
  await mkdir(path.join(project.parent, 'foreign'));
  await symlink(path.join(project.parent, 'foreign'), path.join(project.root, '.review'));
  await expect(installReview({ root: project.root, template: template.root })).rejects.toThrow(
    'Symlinked parent',
  );
  expect(await Bun.file(path.join(project.parent, 'foreign/tooling.json')).exists()).toBe(false);
});

test('a partially copied generation converges and custom retired skills remain untouched', async () => {
  await using template = await source();
  await using project = await gitRepo({
    'package.json': '{}',
    '.agents/skills/deliver/SKILL.md': 'new shared delivery\n',
    '.agents/skills/audit/SKILL.md': 'Customized old audit\n',
  });
  const result6 = await installReview({ root: project.root, template: template.root });
  expect(result6.conflicts).toContain('.agents/skills/audit/SKILL.md');
  await git(project.root, 'rm', '.agents/skills/audit/SKILL.md');
  await git(project.root, 'commit', '-qm', 'Remove reviewed legacy skill');
  const result7 = await installReview({ root: project.root, template: template.root });
  expect(result7.status).toBe('installed');
});

test('an overbroad source copy list cannot distribute the template-specific verify', async () => {
  await using template = await source();
  const config = await readFile(path.join(template.root, 'review.files.yaml'), 'utf-8');
  await template.write({
    'review.files.yaml': config.replace('  - .agents/skills/deliver/', '  - .agents/skills/'),
  });
  await git(template.root, 'commit', '-qam', 'Accidental broad export');
  await using project = await gitRepo({ 'package.json': '{}' });
  await expect(installReview({ root: project.root, template: template.root })).rejects.toThrow(
    'must be generated',
  );
});
