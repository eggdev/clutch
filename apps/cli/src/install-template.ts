import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';

import { isMap, isSeq, parseDocument } from 'yaml';

import type { Detection } from '@/detect-project';
import { gitOrThrow } from '@/git';
import { mergePackageJson } from '@/merge-package-json';
import type { Conflict } from '@/merge-package-json';

type Rule = 'replace' | 'merge' | 'add';
type CopyList = { files: Array<{ path: string; rule: Rule }>; exclude?: Array<string> };
type FileAction = { path: string; action: 'added' | 'replaced' | 'merged' };

type Merged = { content: string; conflicts: Array<Conflict> };

/** Objects merge key by key, and lists keep the items of both. The template wins a clash. */
function mergeJson(project: string, template: string): Merged {
  const merged = mergePackageJson(JSON.parse(project), JSON.parse(template));
  return { content: `${JSON.stringify(merged.manifest, null, 2)}\n`, conflicts: merged.conflicts };
}

/** How the merge rule combines the project's copy of a file with the template's, by file name. */
const mergers: Record<string, (project: string, template: string) => Merged> = {
  'package.json': mergeJson,
  // Agent hook configs. A project keeps its own hooks and settings, and gains the template's hooks.
  'settings.json': mergeJson,
  'hooks.json': mergeJson,
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

/** The clone that this CLI runs from. Its formatter writes the merged files. */
const cliRoot = path.resolve(import.meta.dir, '../../..');

/** Writes `file` in the template's format, so that the format check passes after the install. */
async function format(root: string, file: string) {
  const oxfmt = Bun.spawn(
    [
      path.join(cliRoot, 'node_modules/.bin/oxfmt'),
      '--config',
      path.join(cliRoot, '.oxfmtrc.json'),
      file,
    ],
    { cwd: root, stdout: 'ignore', stderr: 'pipe' },
  );
  if ((await oxfmt.exited) !== 0) {
    throw new Error(`Could not format ${file}: ${await new Response(oxfmt.stderr).text()}`);
  }
}

const registryPath = 'docs/contributing/architecture/primitives.yaml';

/**
 * Removes each primitive from the copied registry when the project has no
 * file under any of its `code` roots. The template registers parts that stay
 * in the template, such as this installer.
 */
async function pruneRegistry(root: string, files: Array<string>) {
  const file = path.join(root, registryPath);
  const doc = parseDocument(await readFile(file, 'utf-8'));
  const primitives = doc.get('primitives');
  if (!isSeq(primitives)) {
    return;
  }
  const present = (code: string) => files.some((name) => name.startsWith(code));
  primitives.items = primitives.items.filter((item) => {
    const code = isMap(item) ? item.get('code') : undefined;
    return !isSeq(code) || code.items.some((entry) => present(String(entry)));
  });
  await writeFile(file, doc.toString());
}

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
 * Switches the project's checkout to a new branch from its default branch,
 * copies the template files named in `template.files.yaml`, writes the install
 * manifest and commits.
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
    const tracked = await listFiles(template, commit, entry.path);
    const names = tracked.filter(
      (name) =>
        !(list.exclude ?? []).some((excluded) =>
          excluded.endsWith('/') ? name.startsWith(excluded) : name === excluded,
        ),
    );
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

  const { root } = project;
  await gitOrThrow(root, 'switch', '--quiet', '--create', branch, project.defaultBranch);
  const copies = files.filter((file) => file.action !== 'merged').map((file) => file.path);
  if (copies.length) {
    await extract(template, commit, copies, root);
  }

  const conflicts: Array<Conflict & { file: string }> = [];
  for (const name of merges) {
    const merged = mergers[path.basename(name)](
      await gitOrThrow(root, 'show', `${project.defaultBranch}:${name}`),
      await gitOrThrow(template, 'show', `${commit}:${name}`),
    );
    await writeFile(path.join(root, name), merged.content);
    if (path.basename(name) === 'package.json') {
      await format(root, name);
    }
    conflicts.push(...merged.conflicts.map((conflict) => ({ file: name, ...conflict })));
  }

  if (copies.includes(registryPath)) {
    await pruneRegistry(root, [...existing, ...files.map((file) => file.path)]);
  }

  const base = {
    branch: project.defaultBranch,
    commit: await gitOrThrow(root, 'rev-parse', project.defaultBranch),
  };
  const manifest = { template: { commit }, base, stage: 'survey', files, conflicts };
  await mkdir(path.join(root, path.dirname(manifestPath)), { recursive: true });
  await writeFile(path.join(root, manifestPath), `${JSON.stringify(manifest, null, 2)}\n`);
  await gitOrThrow(root, 'add', '--all');
  await gitOrThrow(root, 'commit', '--quiet', '--message', 'Install template: copy files');
  return { manifest };
}
