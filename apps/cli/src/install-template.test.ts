import { expect, test } from 'bun:test';
import { mkdir, readFile, readlink, symlink } from 'node:fs/promises';
import path from 'node:path';

import { gitOrThrow as git } from '@/git';
import { installTemplate } from '@/install-template';
import { gitRepo } from '@/testing/git-repo';
import { copyList, existing, install } from '@/testing/install';

test('the install switches the checkout to a new branch from the default branch, and copies the files there', async () => {
  await using template = await gitRepo({
    'clutch.files.yaml': copyList,
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

  const result = await install(project.root, template.root, { take: ['AGENTS.md'] });

  expect(await git(project.root, 'branch', '--show-current')).toBe('template/install');
  expect(await git(project.root, 'log', '--format=%s')).toBe(
    'Install template: copy files\nInitial commit',
  );
  expect(await git(project.root, 'ls-files')).toBe(
    [
      '.clutch/lineage.json',
      '.template-install/manifest.json',
      'AGENTS.md',
      'CHANGELOG.md',
      'package.json',
      'tools/check.ts',
    ].join('\n'),
  );
  expect(await readFile(path.join(project.root, 'AGENTS.md'), 'utf-8')).toBe('# Template agents\n');
  expect(
    JSON.parse(await readFile(path.join(project.root, '.template-install/manifest.json'), 'utf-8')),
  ).toEqual({
    template: { commit: await git(template.root, 'rev-parse', 'HEAD') },
    base: { branch: 'main', commit: await git(project.root, 'rev-parse', 'main') },
    stage: 'survey',
    files: [
      { path: 'tools/check.ts', action: 'added' },
      { path: 'AGENTS.md', action: 'replaced' },
      { path: 'CHANGELOG.md', action: 'added' },
    ],
    conflicts: [],
  });
  expect(result.manifest.stage).toBe('survey');
  expect(await git(project.root, 'status', '--porcelain')).toBe('');
  expect(await git(project.root, 'ls-files')).not.toContain('feature.ts');
});

test('package.json merges, and the manifest lists each clash for the interview', async () => {
  await using template = await gitRepo({
    'clutch.files.yaml': 'version: 1\nfiles:\n  - path: package.json\n    rule: merge\n',
    'package.json': JSON.stringify({
      name: 'clutch',
      packageManager: 'bun@1.4.2',
      scripts: { validate: 'nx run-many -t test' },
    }),
  });
  await using project = await gitRepo(
    { 'package.json': JSON.stringify({ name: 'shop', packageManager: 'npm@11.0.0' }) },
    { name: 'shop' },
  );

  await install(project.root, template.root);

  expect(JSON.parse(await readFile(path.join(project.root, 'package.json'), 'utf-8'))).toEqual({
    name: 'shop',
    packageManager: 'bun@1.4.2',
    scripts: { validate: 'nx run-many -t test' },
  });
  expect(
    JSON.parse(await readFile(path.join(project.root, '.template-install/manifest.json'), 'utf-8')),
  ).toMatchObject({
    files: [
      { path: 'package.json', action: 'merged' },
      { path: 'CHANGELOG.md', action: 'added' },
    ],
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

test('a project file that differs from a managed file waits for a decision before any branch exists', async () => {
  await using template = await gitRepo({
    'clutch.files.yaml': copyList,
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

  const result = await installTemplate({
    project: await existing(project.root),
    template: template.root,
  });
  expect(result).toEqual({
    status: 'decisions',
    decisions: [
      { path: 'tools/check.ts', rule: 'managed' },
      { path: 'tools/hooks/install.ts', rule: 'managed' },
    ],
  });
  expect(await git(project.root, 'branch', '--list', 'template/install')).toBe('');
  expect(await git(project.root, 'branch', '--show-current')).toBe('main');
});

test('skill symlinks stay symlinks, so Claude finds the skills that live in .agents', async () => {
  await using template = await gitRepo({
    'clutch.files.yaml':
      'version: 1\nfiles:\n  - path: .agents/\n    rule: managed\n  - path: .claude/\n    rule: managed\n',
    '.agents/skills/kickoff/SKILL.md': '# Kickoff\n',
  });
  await mkdir(path.join(template.root, '.claude/skills'), { recursive: true });
  await symlink('../../.agents/skills/kickoff', path.join(template.root, '.claude/skills/kickoff'));
  await git(template.root, 'add', '--all');
  await git(template.root, 'commit', '--quiet', '--message', 'Link the skill');
  await using project = await gitRepo({ 'package.json': '{}' }, { name: 'shop' });

  await install(project.root, template.root);

  expect(await readlink(path.join(project.root, '.claude/skills/kickoff'))).toBe(
    '../../.agents/skills/kickoff',
  );
  expect(await readFile(path.join(project.root, '.claude/skills/kickoff/SKILL.md'), 'utf-8')).toBe(
    '# Kickoff\n',
  );
});

test('full template install excludes source verify and preserves an existing project executor', async () => {
  await using template = await gitRepo({
    'clutch.files.yaml':
      'version: 1\nexclude:\n  - .agents/skills/verify/\nfiles:\n  - path: .agents/skills/\n    rule: managed\n',
    '.agents/skills/verify/SKILL.md': 'Template-source proof\n',
    '.agents/skills/setup-verification/SKILL.md': 'Author project proof\n',
  });
  await using project = await gitRepo({
    'package.json': '{}',
    '.agents/skills/verify/SKILL.md': 'Project assertions\n',
  });
  const { manifest } = await install(project.root, template.root);
  expect(await readFile(path.join(project.root, '.agents/skills/verify/SKILL.md'), 'utf-8')).toBe(
    'Project assertions\n',
  );
  expect(manifest.files.some((file) => file.path === '.agents/skills/verify/SKILL.md')).toBe(false);
  expect(
    await readFile(path.join(project.root, '.agents/skills/setup-verification/SKILL.md'), 'utf-8'),
  ).toBe('Author project proof\n');
});

test('a copy list entry that matches no template file stops the install', async () => {
  await using template = await gitRepo({
    'clutch.files.yaml': copyList,
    'AGENTS.md': '# Template agents\n',
  });
  await using project = await gitRepo({ 'package.json': '{}' }, { name: 'shop' });
  await expect(
    installTemplate({ project: await existing(project.root), template: template.root }),
  ).rejects.toThrow('clutch.files.yaml: tools/ matches no committed file.');
});

test(".gitignore merges: the project keeps its entries and gains the template's", async () => {
  await using template = await gitRepo({
    'clutch.files.yaml': 'version: 1\nfiles:\n  - path: .gitignore\n    rule: merge\n',
    '.gitignore': '# Dependencies\nnode_modules\n\n# Nx\n.nx/cache\n',
  });
  await using project = await gitRepo(
    { 'package.json': '{}', '.gitignore': 'node_modules\n.env\n' },
    { name: 'shop' },
  );

  const { manifest } = await install(project.root, template.root);

  expect(await readFile(path.join(project.root, '.gitignore'), 'utf-8')).toBe(
    'node_modules\n.env\n\n# From Clutch\n.nx/cache\n',
  );
  expect(manifest.files).toEqual([
    { path: '.gitignore', action: 'merged' },
    { path: 'CHANGELOG.md', action: 'added' },
  ]);
});

/** A hook group that runs one command. */
const hook = (command: string) => ({ hooks: [{ type: 'command', command }] });

test("a project's Claude Code settings merge: it keeps its hooks and gains the template's", async () => {
  await using template = await gitRepo({
    'clutch.files.yaml': 'version: 1\nfiles:\n  - path: .claude/settings.json\n    rule: merge\n',
    '.claude/settings.json': JSON.stringify({ hooks: { Stop: [hook('template stop')] } }),
  });
  await using project = await gitRepo(
    {
      'package.json': '{}',
      '.claude/settings.json': JSON.stringify({
        model: 'opus',
        hooks: { Stop: [hook('project stop')] },
      }),
    },
    { name: 'shop' },
  );

  const { manifest } = await install(project.root, template.root);

  const settings = JSON.parse(
    await readFile(path.join(project.root, '.claude/settings.json'), 'utf-8'),
  );
  expect(settings).toEqual({
    model: 'opus',
    hooks: { Stop: [hook('project stop'), hook('template stop')] },
  });
  expect(manifest.files).toEqual([
    { path: '.claude/settings.json', action: 'merged' },
    { path: 'CHANGELOG.md', action: 'added' },
  ]);
});

test("each entry in this template's copy list names tracked files", async () => {
  const root = path.resolve(import.meta.dir, '../../..');
  const list = Bun.YAML.parse(await readFile(path.join(root, 'clutch.files.yaml'), 'utf-8')) as {
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

test('the registry keeps only the primitives whose code the install copies', async () => {
  const registry = [
    '# The registry.',
    'version: 1',
    '',
    'primitives:',
    '  - id: repository-tools',
    '    kind: tool',
    '    code:',
    '      - tools/',
    '',
    '  # The installer itself.',
    '  - id: clutch-cli',
    '    kind: app',
    '    code:',
    '      - apps/cli/',
    '',
    '  - id: shop-web',
    '    kind: app',
    '    code:',
    '      - apps/web/',
    '',
  ].join('\n');
  await using template = await gitRepo({
    'clutch.files.yaml': `${copyList}  - path: docs/\n    rule: seed\n`,
    'AGENTS.md': '# Template agents\n',
    'tools/check.ts': 'export {};\n',
    'apps/cli/main.ts': 'export {};\n',
    'docs/contributing/architecture/primitives.yaml': registry,
  });
  await using project = await gitRepo(
    { 'package.json': '{}', 'apps/web/index.ts': 'export {};\n' },
    { name: 'shop' },
  );

  await install(project.root, template.root);

  expect(
    await readFile(
      path.join(project.root, 'docs/contributing/architecture/primitives.yaml'),
      'utf-8',
    ),
  ).toBe(
    [
      '# The registry.',
      'version: 1',
      '',
      'primitives:',
      '  - id: repository-tools',
      '    kind: tool',
      '    code:',
      '      - tools/',
      '',
      '  - id: shop-web',
      '    kind: app',
      '    code:',
      '      - apps/web/',
      '',
    ].join('\n'),
  );
});

test('the merged package.json is in the format that the template checks', async () => {
  await using template = await gitRepo({
    'clutch.files.yaml': 'version: 1\nfiles:\n  - path: package.json\n    rule: merge\n',
    'package.json': JSON.stringify({ name: 'clutch', workspaces: ['apps/*'] }),
  });
  await using project = await gitRepo(
    { 'package.json': JSON.stringify({ type: 'module', name: 'shop' }) },
    { name: 'shop' },
  );

  await install(project.root, template.root);

  expect(await readFile(path.join(project.root, 'package.json'), 'utf-8')).toBe(
    '{\n  "name": "shop",\n  "workspaces": [\n    "apps/*"\n  ],\n  "type": "module"\n}\n',
  );
});

test('a project starts a fresh changelog, and keeps its own when it has one', async () => {
  await using template = await gitRepo({
    'clutch.files.yaml':
      'version: 1\nfiles:\n  - path: AGENTS.md\n    rule: seed\nexclude:\n  - CHANGELOG.md\n',
    'AGENTS.md': '# Agents\n',
    'CHANGELOG.md': '# Changelog\n\n## 1.4.0\n\n- Clutch history\n',
  });
  await using fresh = await gitRepo({ 'package.json': '{}' }, { name: 'shop' });
  await install(fresh.root, template.root);
  expect(await readFile(path.join(fresh.root, 'CHANGELOG.md'), 'utf-8')).toBe('# Changelog\n');

  await using owned = await gitRepo(
    { 'package.json': '{}', 'CHANGELOG.md': '# Changelog\n\n## 2.0.0\n' },
    { name: 'own' },
  );
  await install(owned.root, template.root);
  expect(await readFile(path.join(owned.root, 'CHANGELOG.md'), 'utf-8')).toBe(
    '# Changelog\n\n## 2.0.0\n',
  );
});
