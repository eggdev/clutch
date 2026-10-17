import { expect, test } from 'bun:test';
import { readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';

import { detectProject } from '@apps/cli/src/detect-project';
import { installTemplate } from '@apps/cli/src/install-template';
import { nextStep } from '@apps/cli/src/next-step';
import { git, gitRepo } from '@apps/cli/src/testing/git-repo';

async function installed() {
  const template = await gitRepo({
    'template.files.yaml': 'files:\n  - path: AGENTS.md\n    rule: replace\n',
    'AGENTS.md': '# Template agents\n',
  });
  const project = await gitRepo({ 'package.json': '{}' }, { name: 'shop' });
  const detection = await detectProject(project.root);
  if (detection.kind !== 'existing') {
    throw new Error(detection.reason);
  }
  const { worktree } = await installTemplate({ project: detection, template: template.root });
  return {
    project,
    worktree,
    [Symbol.asyncDispose]: async () => {
      await template[Symbol.asyncDispose]();
      await project[Symbol.asyncDispose]();
    },
  };
}

test('a project without the install branch starts with the install', async () => {
  await using project = await gitRepo({ 'package.json': '{}' });
  expect(await nextStep(project.root)).toEqual({ step: 'install' });
});

test('after the copy, the next step is the survey in the install worktree', async () => {
  await using setup = await installed();
  expect(await nextStep(setup.project.root)).toEqual({ step: 'survey', worktree: setup.worktree });
});

test('the stage in the manifest decides the step when a run resumes', async () => {
  await using setup = await installed();
  const manifest = path.join(setup.worktree, '.template-install/manifest.json');
  const data = JSON.parse(await readFile(manifest, 'utf-8'));
  await writeFile(manifest, JSON.stringify({ ...data, stage: 'interview' }));
  await git(setup.worktree, 'commit', '--quiet', '--all', '--message', 'Survey done');
  expect(await nextStep(setup.project.root)).toEqual({
    step: 'interview',
    worktree: setup.worktree,
  });
});

test('when the worktree was removed, the run adds it back from the install branch', async () => {
  await using setup = await installed();
  await git(setup.project.root, 'worktree', 'remove', setup.worktree);
  expect(await nextStep(setup.project.root)).toEqual({ step: 'survey', worktree: setup.worktree });
  expect(await git(setup.worktree, 'branch', '--show-current')).toBe('template/install');
});
