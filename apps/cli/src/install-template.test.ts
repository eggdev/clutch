import { expect, test } from 'bun:test';
import { mkdir, readFile, readlink, symlink } from 'node:fs/promises';
import path from 'node:path';

import { detectProject } from '@apps/cli/src/detect-project';
import { installTemplate } from '@apps/cli/src/install-template';
import { git, gitRepo } from '@apps/cli/src/testing/git-repo';

const copyList = `
files:
  - path: AGENTS.md
    rule: replace
  - path: tools/
    rule: add
`;

async function existing(root: string) {
  const detection = await detectProject(root);
  if (detection.kind !== 'existing') {
    throw new Error(detection.reason);
  }
  return detection;
}

test('the install copies the files into a worktree on a new branch from the default branch, and leaves the checkout alone', async () => {
  await using template = await gitRepo({
    'template.files.yaml': copyList,
    'AGENTS.md': '# Template agents\n',
    'tools/check.ts': 'export {};\n',
    'README.md': '# The template itself\n',
  });
  await using project = await gitRepo(
    { 'package.json': '{"name": "shop"}', 'AGENTS.md': '# Shop agents\n' },
    { name: 'shop' },
  );
  await git(project.root, 'switch', '--quiet', '--create', 'feat/rebuild');
  await project.write({ 'feature.ts': 'export {};\n' });
  await git(project.root, 'add', '--all');
  await git(project.root, 'commit', '--quiet', '--message', 'Feature work');

  const result = await installTemplate({
    project: await existing(project.root),
    template: template.root,
  });

  const worktree = path.join(project.parent, 'shop-template-install');
  expect(result.worktree).toBe(worktree);
  expect(await git(worktree, 'branch', '--show-current')).toBe('template/install');
  expect(await git(worktree, 'log', '--format=%s')).toBe(
    'Install template: copy files\nInitial commit',
  );
  expect(await git(worktree, 'ls-files')).toBe(
    ['.template-install/manifest.json', 'AGENTS.md', 'package.json', 'tools/check.ts'].join('\n'),
  );
  expect(await readFile(path.join(worktree, 'AGENTS.md'), 'utf-8')).toBe('# Template agents\n');
  expect(
    JSON.parse(await readFile(path.join(worktree, '.template-install/manifest.json'), 'utf-8')),
  ).toEqual({
    template: { commit: await git(template.root, 'rev-parse', 'HEAD') },
    base: { branch: 'main', commit: await git(project.root, 'rev-parse', 'main') },
    stage: 'survey',
    files: [
      { path: 'AGENTS.md', action: 'replaced' },
      { path: 'tools/check.ts', action: 'added' },
    ],
    conflicts: [],
  });
  expect(await git(project.root, 'branch', '--show-current')).toBe('feat/rebuild');
  expect(await git(project.root, 'status', '--porcelain')).toBe('');
});

test('package.json merges, and the manifest lists each clash for the interview', async () => {
  await using template = await gitRepo({
    'template.files.yaml': 'files:\n  - path: package.json\n    rule: merge\n',
    'package.json': JSON.stringify({
      name: 'project-template',
      packageManager: 'bun@1.4.2',
      scripts: { validate: 'nx run-many -t test' },
    }),
  });
  await using project = await gitRepo(
    { 'package.json': JSON.stringify({ name: 'shop', packageManager: 'npm@11.0.0' }) },
    { name: 'shop' },
  );

  const { worktree } = await installTemplate({
    project: await existing(project.root),
    template: template.root,
  });

  expect(JSON.parse(await readFile(path.join(worktree, 'package.json'), 'utf-8'))).toEqual({
    name: 'shop',
    packageManager: 'bun@1.4.2',
    scripts: { validate: 'nx run-many -t test' },
  });
  expect(
    JSON.parse(await readFile(path.join(worktree, '.template-install/manifest.json'), 'utf-8')),
  ).toMatchObject({
    files: [{ path: 'package.json', action: 'merged' }],
    conflicts: [
      {
        file: 'package.json',
        path: 'packageManager',
        project: 'npm@11.0.0',
        template: 'bun@1.4.2',
      },
    ],
  });
});

test('a project file in an add path stops the install before any branch or worktree exists', async () => {
  await using template = await gitRepo({
    'template.files.yaml': copyList,
    'AGENTS.md': '# Template agents\n',
    'tools/check.ts': 'export {};\n',
    'tools/hooks/install.ts': 'export {};\n',
  });
  await using project = await gitRepo(
    {
      'package.json': '{}',
      'tools/check.ts': "// the project's own script\n",
      'tools/hooks/install.ts': '',
    },
    { name: 'shop' },
  );

  await expect(
    installTemplate({ project: await existing(project.root), template: template.root }),
  ).rejects.toThrow(
    [
      'The template adds files that the project already has. Move or rename them, commit, then run this again:',
      '  tools/check.ts',
      '  tools/hooks/install.ts',
    ].join('\n'),
  );
  expect(await git(project.root, 'branch', '--list', 'template/install')).toBe('');
  expect(await git(project.root, 'worktree', 'list', '--porcelain')).not.toContain(
    'shop-template-install',
  );
});

test('skill symlinks stay symlinks, so Claude finds the skills that live in .agents', async () => {
  await using template = await gitRepo({
    'template.files.yaml':
      'files:\n  - path: .agents/\n    rule: add\n  - path: .claude/\n    rule: add\n',
    '.agents/skills/kickoff/SKILL.md': '# Kickoff\n',
  });
  await mkdir(path.join(template.root, '.claude/skills'), { recursive: true });
  await symlink('../../.agents/skills/kickoff', path.join(template.root, '.claude/skills/kickoff'));
  await git(template.root, 'add', '--all');
  await git(template.root, 'commit', '--quiet', '--message', 'Link the skill');
  await using project = await gitRepo({ 'package.json': '{}' }, { name: 'shop' });

  const { worktree } = await installTemplate({
    project: await existing(project.root),
    template: template.root,
  });

  expect(await readlink(path.join(worktree, '.claude/skills/kickoff'))).toBe(
    '../../.agents/skills/kickoff',
  );
  expect(await readFile(path.join(worktree, '.claude/skills/kickoff/SKILL.md'), 'utf-8')).toBe(
    '# Kickoff\n',
  );
});

test('a copy list entry that matches no template file stops the install', async () => {
  await using template = await gitRepo({
    'template.files.yaml': copyList,
    'AGENTS.md': '# Template agents\n',
  });
  await using project = await gitRepo({ 'package.json': '{}' }, { name: 'shop' });
  await expect(
    installTemplate({ project: await existing(project.root), template: template.root }),
  ).rejects.toThrow('template.files.yaml: tools/ matches no file in the template');
});

test(".gitignore merges: the project keeps its entries and gains the template's", async () => {
  await using template = await gitRepo({
    'template.files.yaml': 'files:\n  - path: .gitignore\n    rule: merge\n',
    '.gitignore': '# Dependencies\nnode_modules\n\n# Nx\n.nx/cache\n',
  });
  await using project = await gitRepo(
    { 'package.json': '{}', '.gitignore': 'node_modules\n.env\n' },
    { name: 'shop' },
  );

  const { worktree, manifest } = await installTemplate({
    project: await existing(project.root),
    template: template.root,
  });

  expect(await readFile(path.join(worktree, '.gitignore'), 'utf-8')).toBe(
    'node_modules\n.env\n\n# From the project template\n.nx/cache\n',
  );
  expect(manifest.files).toEqual([{ path: '.gitignore', action: 'merged' }]);
});

test("each entry in this template's copy list names tracked files", async () => {
  const root = path.resolve(import.meta.dir, '../../..');
  const list = Bun.YAML.parse(await readFile(path.join(root, 'template.files.yaml'), 'utf-8')) as {
    files: Array<{ path: string }>;
  };
  const untracked = [];
  for (const entry of list.files) {
    if (!(await git(root, 'ls-files', '--', entry.path))) {
      untracked.push(entry.path);
    }
  }
  expect(untracked).toEqual([]);
});
