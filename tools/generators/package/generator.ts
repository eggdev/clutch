import path from 'node:path';

import type { Tree } from '@nx/devkit';
import { generateFiles, names, updateJson } from '@nx/devkit';
import { addRecord, parseGroup } from '@tools/generators/record/generator.ts';
import {
  addAppDependency,
  addDependencies,
  addPrimitive,
  afterWrite,
  clientAppDirectories,
  versionOf,
  writeProject,
} from '@tools/generators/shared/workspace.ts';

export const sections = [
  'types',
  'config',
  'contract',
  'commands',
  'repo',
  'service',
  'jobs',
  'runtime',
  'ui',
  'testing',
] as const;

export type PackageOptions = {
  readonly name: string;
  readonly sections: string;
  readonly record?: string;
  /** The sync group of the first record. Required with `record`. See the record generator. */
  readonly group?: string;
  readonly summary?: string;
};

/** The sections to make, in the order of the section table. Each one is checked. */
export function parseSections(list: string): ReadonlyArray<string> {
  const wanted = list
    .split(',')
    .map((section) => section.trim())
    .filter(Boolean);
  const unknown = wanted.filter((section) => !sections.some((known) => known === section));
  if (unknown.length) {
    throw new Error(`Unknown sections: ${unknown.join(', ')}. Use: ${sections.join(', ')}.`);
  }
  if (!wanted.includes('contract') && !wanted.includes('types')) {
    throw new Error(
      'A package needs `contract/` or `types/`: the section that says what it offers.',
    );
  }
  return sections.filter((section) => wanted.includes(section));
}

/**
 * The repo section: drizzle-kit config, an empty migrations folder and the
 * `db-generate` target. The server half in `runtime/server.server.ts` runs the
 * migrations at start. Only drizzle-kit writes a migration.
 */
function addRepo(tree: Tree, directory: string, name: ReturnType<typeof names>) {
  generateFiles(tree, path.join(import.meta.dirname, 'repo'), directory, {
    ...name,
    title: name.fileName.replaceAll('-', ' '),
  });
  addDependencies(
    tree,
    directory,
    { '@repo/sync': 'workspace:*', 'drizzle-orm': versionOf(tree, 'drizzle-orm') },
    ['../sync'],
  );
  updateJson(tree, `${directory}/package.json`, (manifest) => ({
    ...manifest,
    devDependencies: { ...manifest.devDependencies, 'drizzle-kit': versionOf(tree, 'drizzle-kit') },
    nx: {
      ...manifest.nx,
      targets: {
        ...manifest.nx.targets,
        'db-generate': {
          executor: 'nx:run-commands',
          options: { command: 'drizzle-kit generate', cwd: directory },
        },
      },
    },
  }));
  addAppDependency(tree, 'apps/api/package.json', `@repo/${name.fileName}`);
}

/**
 * The contract section: `contract/<name>.ts`, which declares the package's
 * records, commands and loads, and the sync dependency that it needs. The
 * runtime files of the package list it, and `nx sync` writes each app's list.
 */
function addContract(tree: Tree, directory: string, name: ReturnType<typeof names>, title: string) {
  tree.write(
    `${directory}/contract/${name.fileName}.ts`,
    [
      "import { defineContract } from '@repo/sync/contract/define';",
      '',
      '/**',
      ` * The contract of ${title}: each record, command and load function of the`,
      ' * package. The object pool, the server, the manifest and each tool read it.',
      ' */',
      `export const ${name.propertyName}Contract = defineContract('${name.fileName}', {`,
      '  records: [],',
      '  commands: [],',
      '  loads: [],',
      '  jobs: [],',
      '  routes: [],',
      '});',
      '',
    ].join('\n'),
  );
  addDependencies(tree, directory, { '@repo/sync': 'workspace:*' }, ['../sync']);
  for (const app of [...clientAppDirectories(tree), 'apps/api']) {
    addAppDependency(tree, `${app}/package.json`, `@repo/${name.fileName}`);
  }
}

/**
 * The runtime section: `runtime/client.ts` and `runtime/server.server.ts`, which
 * list the package's contract with an empty list of each half, and
 * `runtime/contract-claims.test.ts`, which proves the claims of the contract.
 * The sync generator adds the package to each app's list. A package with `repo/` runs
 * its migrations from the server half.
 */
function addRuntime(
  tree: Tree,
  directory: string,
  name: ReturnType<typeof names>,
  title: string,
  repo: boolean,
) {
  generateFiles(tree, path.join(import.meta.dirname, 'runtime'), `${directory}/runtime`, {
    ...name,
    title,
    repo,
  });
}

/** The problems with the chosen sections and record, before any file is written. */
function planProblem(chosen: ReadonlyArray<string>, record: string | undefined) {
  if (chosen.includes('runtime') && !chosen.includes('contract')) {
    return 'A package with `runtime/` needs `contract/`: its runtime files list the contract.';
  }
  if (chosen.includes('repo') && !chosen.includes('runtime')) {
    return 'A package with `repo/` needs `runtime/`. Its `server.server.ts` runs the migrations.';
  }
  if (chosen.includes('repo') && !record) {
    return 'A package with `repo/` owns records. Name the first one with `--record=<name>`.';
  }
  if (chosen.includes('commands') && !chosen.includes('contract')) {
    return 'A package with `commands/` needs `contract/`: each command is declared there.';
  }
  if (record && !chosen.includes('contract')) {
    return 'A record is declared in `contract/`. Add `contract` to the sections, or leave out `--record`.';
  }
  return null;
}

/**
 * Writes a package with only the sections it needs. The contract section
 * holds the declarations. With `--record`, the contract declares the first
 * record, and `repo/` gets its table. Each other section starts empty.
 */
export function addPackage(tree: Tree, options: PackageOptions) {
  const name = names(options.name);
  const directory = `packages/${name.fileName}`;
  const chosen = parseSections(options.sections);
  const problem =
    planProblem(chosen, options.record) ??
    (options.record && !options.group
      ? 'A record needs its sync group. Pass `--group=org`, `--group=user` or `--group=<kind>:<field>`, such as `--group=space:spaceId`.'
      : null);
  if (problem) {
    throw new Error(problem);
  }
  if (options.group !== undefined) {
    parseGroup(options.group);
  }
  writeProject(tree, {
    directory,
    name: `@repo/${name.fileName}`,
    tag: 'type:package',
    dependencies: { effect: versionOf(tree, 'effect') },
    references: [],
    react: chosen.includes('ui'),
  });
  const title = name.fileName.replaceAll('-', ' ');
  generateFiles(tree, path.join(import.meta.dirname, 'files'), directory, {
    heading: `${title.charAt(0).toUpperCase()}${title.slice(1)}`,
    summary: options.summary ?? 'Say what this package owns.',
    sectionList: chosen.map((section) => `\`${section}/\``).join(', '),
  });
  if (chosen.includes('contract')) {
    addContract(tree, directory, name, title);
    addRuntime(tree, directory, name, title, chosen.includes('repo'));
  }
  if (chosen.includes('repo')) {
    addRepo(tree, directory, name);
  }
  if (options.record && options.group) {
    addRecord(tree, { package: name.fileName, name: options.record, group: options.group });
  }
  for (const section of chosen) {
    if (!tree.children(`${directory}/${section}`).length) {
      tree.write(`${directory}/${section}/.gitkeep`, '');
    }
  }
  addPrimitive(tree, {
    id: name.fileName,
    group: 'product',
    name: `${title.charAt(0).toUpperCase()}${title.slice(1)}`,
    kind: 'package',
    summary: options.summary ?? 'Say what this package owns.',
    code: [`${directory}/`],
    docs: [`${directory}/README.md`],
  });
}

/** Adds a package, and returns the step that installs and formats the result. */
export function packageGenerator(tree: Tree, options: PackageOptions) {
  addPackage(tree, options);
  return afterWrite(tree, true);
}
