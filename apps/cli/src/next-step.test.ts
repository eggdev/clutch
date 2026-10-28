import { expect, test } from 'bun:test';
import { readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';

import { detectProject } from '@apps/cli/src/detect-project';
import { gitOrThrow as git } from '@apps/cli/src/git';
import { installTemplate } from '@apps/cli/src/install-template';
import { nextStep } from '@apps/cli/src/next-step';
import { gitRepo } from '@apps/cli/src/testing/git-repo';

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
  await installTemplate({ project: detection, template: template.root });
  return {
    project,
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

test('after the copy, the next step is the survey', async () => {
  await using setup = await installed();
  expect(await nextStep(setup.project.root)).toEqual({ step: 'survey' });
});

test('the stage in the manifest decides the step when a run resumes', async () => {
  await using setup = await installed();
  const { root } = setup.project;
  const manifest = path.join(root, '.template-install/manifest.json');
  const data = JSON.parse(await readFile(manifest, 'utf-8'));
  await writeFile(manifest, JSON.stringify({ ...data, stage: 'interview' }));
  await git(root, 'commit', '--quiet', '--all', '--message', 'Survey done');
  expect(await nextStep(root)).toEqual({ step: 'interview' });
});

test('when the checkout is on another branch, the run switches back to the install branch', async () => {
  await using setup = await installed();
  const { root } = setup.project;
  await git(root, 'switch', '--quiet', 'main');
  expect(await nextStep(root)).toEqual({ step: 'survey' });
  expect(await git(root, 'branch', '--show-current')).toBe('template/install');
});

test('when the migration deleted the install folder, kickoff is done', async () => {
  await using setup = await installed();
  const { root } = setup.project;
  await git(root, 'rm', '--quiet', '-r', '.template-install');
  await git(root, 'commit', '--quiet', '--message', 'Migrate: remove the install folder');
  expect(await nextStep(root)).toEqual({ step: 'done' });
});
