import { stat } from 'node:fs/promises';
import path from 'node:path';
import { parseArgs } from 'node:util';

import { loadClutchConfig } from '@/clutch-config/load';
import { checkFactoryTree, factoryTreeRoot } from '@/factory/check';
import { writeSchemaFiles } from '@/factory/schema-files';
import { git } from '@/git';

const schemaPage = 'docs/contributing/architecture/factory-tree.md';

/** The repository that holds `cwd`, or `cwd` when it is not in one. */
async function projectRoot(cwd: string) {
  const top = await git(cwd, 'rev-parse', '--show-toplevel');
  return top.ok ? top.out : cwd;
}

async function isFolder(dir: string) {
  try {
    const info = await stat(dir);
    return info.isDirectory();
  } catch {
    return false;
  }
}

/**
 * The tree root: `--root` from `cwd`, or `factory.root` in clutch.yaml from
 * the project root. `base` is the folder that the output shows paths from.
 * `explicit` is true when a person named the root, so a missing folder fails.
 * `project` is the repository that holds `cwd`, where `reads` paths start.
 */
export async function treeRoot(cwd: string, flag: string | undefined) {
  const project = await projectRoot(cwd);
  if (flag !== undefined) {
    return { dir: path.resolve(cwd, flag), base: cwd, explicit: true, project };
  }
  const loaded = await loadClutchConfig(project);
  if (loaded.kind === 'invalid') {
    throw new Error('clutch.yaml is not valid. Run `clutch doctor --check` to see why.');
  }
  const config = loaded.kind === 'loaded' ? loaded.config : undefined;
  // A named root must exist, so a missing folder cannot turn the check into a notice.
  return {
    dir: path.resolve(project, factoryTreeRoot(config)),
    base: project,
    explicit: config?.factory?.root !== undefined,
    project,
  };
}

function display(base: string, file: string) {
  const relative = path.relative(base, file);
  if (relative === '') {
    return '.';
  }
  return relative.startsWith('..') ? file : relative;
}

async function runCheck(cwd: string, flag: string | undefined, json: boolean) {
  const root = await treeRoot(cwd, flag);
  const shown = `${display(root.base, root.dir)}/`;
  if (!(await isFolder(root.dir))) {
    if (root.explicit) {
      console.error(`${shown} is not a folder.`);
      return 1;
    }
    const notice = `No factory tree at ${shown}. Nothing to check.`;
    console.log(json ? JSON.stringify({ root: shown, notice, problems: [] }) : notice);
    return 0;
  }
  const { counts, problems } = await checkFactoryTree(root.dir, root.project);
  const located = problems.map((problem) => ({
    ...problem,
    file: display(root.base, path.join(root.dir, problem.file)),
  }));
  if (json) {
    console.log(JSON.stringify({ root: shown, counts, problems: located }, null, 2));
    return problems.length > 0 ? 1 : 0;
  }
  for (const problem of located) {
    console.error(`${problem.file}: ${problem.key ? `${problem.key}: ` : ''}${problem.reason}`);
  }
  const files = Object.values(counts).reduce((sum, count) => sum + count, 0);
  if (problems.length > 0) {
    const noun = problems.length === 1 ? 'problem' : 'problems';
    console.error(
      `\nThe factory tree at ${shown} has ${problems.length} ${noun}. See ${schemaPage}.`,
    );
    return 1;
  }
  if (files === 0) {
    console.log(`No factory files in ${shown}. Nothing to check.`);
    return 0;
  }
  const summary = Object.entries(counts)
    .filter(([, count]) => count > 0)
    .map(([kind, count]) => {
      if (kind === 'models') {
        return 'models.yaml';
      }
      return `${count} ${count === 1 ? kind.slice(0, -1) : kind}`;
    })
    .join(', ');
  console.log(`The factory tree at ${shown} passes: ${summary}.`);
  return 0;
}

/** `clutch factory --check` and `clutch factory --write-schemas DIR`. */
export async function factoryCommand(args: Array<string>, cwd: string) {
  const { values } = parseArgs({
    args,
    options: {
      check: { type: 'boolean', default: false },
      root: { type: 'string' },
      json: { type: 'boolean', default: false },
      'write-schemas': { type: 'string' },
    },
  });
  const out = values['write-schemas'];
  if (out !== undefined) {
    for (const file of await writeSchemaFiles(path.resolve(cwd, out))) {
      console.log(`Wrote ${display(cwd, file)}.`);
    }
    return 0;
  }
  if (!values.check) {
    console.error('Run clutch factory --check, or clutch factory --write-schemas DIR.');
    return 1;
  }
  return runCheck(cwd, values.root, values.json);
}
