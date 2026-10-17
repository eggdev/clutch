import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';

import type { Detection } from '@apps/cli/src/detect-project';
import { gitOrThrow } from '@apps/cli/src/git';
import { mergePackageJson } from '@apps/cli/src/merge-package-json';
import type { Conflict } from '@apps/cli/src/merge-package-json';

type Rule = 'replace' | 'merge' | 'add';
type CopyList = { files: Array<{ path: string; rule: Rule }> };
type FileAction = { path: string; action: 'added' | 'replaced' | 'merged' };

type Merged = { content: string; conflicts: Array<Conflict> };

/** How the merge rule combines the project's copy of a file with the template's, by file name. */
const mergers: Record<string, (project: string, template: string) => Merged> = {
  'package.json': (project, template) => {
    const merged = mergePackageJson(JSON.parse(project), JSON.parse(template));
    return {
      content: `${JSON.stringify(merged.manifest, null, 2)}\n`,
      conflicts: merged.conflicts,
    };
  },
  '.gitignore': (project, template) => {
    const own = new Set(project.split('\n').map((line) => line.trim()));
    const missing = template
      .split('\n')
      .map((line) => line.trim())
      .filter((line) => line && !line.startsWith('#') && !own.has(line));
    const content = missing.length
      ? `${project}\n\n# From the project template\n${missing.join('\n')}\n`
      : `${project}\n`;
    return { content, conflicts: [] };
  },
};

export const branch = 'template/install';
export const manifestPath = '.template-install/manifest.json';

/** The files that `rev` tracks, under `prefix` when given. */
async function listFiles(cwd: string, rev: string, prefix?: string) {
  const out = await gitOrThrow(
    cwd,
    'ls-tree',
    '-r',
    '--name-only',
    rev,
    '--',
    ...(prefix ? [prefix] : []),
  );
  return out.split('\n').filter(Boolean);
}

/** Copies `paths` from `commit` in the template into `dir`, with their modes and symlinks. */
async function extract(template: string, commit: string, paths: Array<string>, dir: string) {
  const archive = Bun.spawn(['git', 'archive', '--format=tar', commit, '--', ...paths], {
    cwd: template,
    stdout: 'pipe',
  });
  const tar = Bun.spawn(['tar', '-x', '-C', dir], { stdin: archive.stdout });
  if ((await archive.exited) !== 0 || (await tar.exited) !== 0) {
    throw new Error(`Could not copy ${paths.join(', ')} from the template at ${commit}`);
  }
}

/**
 * Makes a worktree next to the project on a new branch from its default
 * branch, copies the template files named in `template.files.yaml`, writes the
 * install manifest and commits. The user's checkout does not change.
 */
export async function installTemplate(options: {
  project: Extract<Detection, { kind: 'existing' }>;
  template: string;
}) {
  const { project, template } = options;
  const commit = await gitOrThrow(template, 'rev-parse', 'HEAD');
  const list: CopyList = Bun.YAML.parse(
    await gitOrThrow(template, 'show', `${commit}:template.files.yaml`),
  ) as CopyList;
  const existing = new Set(await listFiles(project.root, project.defaultBranch));

  const files: Array<FileAction> = [];
  const merges: Array<string> = [];
  const collisions: Array<string> = [];
  for (const entry of list.files) {
    const names = await listFiles(template, commit, entry.path);
    if (!names.length) {
      throw new Error(`template.files.yaml: ${entry.path} matches no file in the template`);
    }
    for (const name of names) {
      if (entry.rule === 'merge' && existing.has(name)) {
        if (!Object.hasOwn(mergers, path.basename(name))) {
          throw new Error(
            `template.files.yaml: the merge rule supports ${Object.keys(mergers).join(' and ')}, not ${name}`,
          );
        }
        merges.push(name);
        files.push({ path: name, action: 'merged' });
      } else if (entry.rule === 'add' && existing.has(name)) {
        collisions.push(name);
      } else {
        files.push({ path: name, action: existing.has(name) ? 'replaced' : 'added' });
      }
    }
  }

  if (collisions.length) {
    throw new Error(
      [
        'The template adds files that the project already has. Move or rename them, commit, then run this again:',
        ...collisions.map((name) => `  ${name}`),
      ].join('\n'),
    );
  }

  const worktree = path.join(path.dirname(project.root), `${project.name}-template-install`);
  await gitOrThrow(
    project.root,
    'worktree',
    'add',
    '--quiet',
    '-b',
    branch,
    worktree,
    project.defaultBranch,
  );
  const copies = files.filter((file) => file.action !== 'merged').map((file) => file.path);
  if (copies.length) {
    await extract(template, commit, copies, worktree);
  }

  const conflicts: Array<Conflict & { file: string }> = [];
  for (const name of merges) {
    const merged = mergers[path.basename(name)](
      await gitOrThrow(project.root, 'show', `${project.defaultBranch}:${name}`),
      await gitOrThrow(template, 'show', `${commit}:${name}`),
    );
    await writeFile(path.join(worktree, name), merged.content);
    conflicts.push(...merged.conflicts.map((conflict) => ({ file: name, ...conflict })));
  }

  const manifest = { template: { commit }, stage: 'survey', files, conflicts };
  await mkdir(path.join(worktree, path.dirname(manifestPath)), { recursive: true });
  await writeFile(path.join(worktree, manifestPath), `${JSON.stringify(manifest, null, 2)}\n`);
  await gitOrThrow(worktree, 'add', '--all');
  await gitOrThrow(worktree, 'commit', '--quiet', '--message', 'Install template: copy files');
  return { worktree, manifest };
}
