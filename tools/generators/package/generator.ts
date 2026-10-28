import path from 'node:path';

import type { Tree } from '@nx/devkit';
import { generateFiles, names, updateJson } from '@nx/devkit';
import { addModel, addRecordSchema, addTable } from '@tools/generators/model/generator.ts';
import {
  addAppDependency,
  addDependencies,
  addPrimitive,
  afterWrite,
  register,
  versionOf,
  writeProject,
} from '@tools/generators/shared/workspace.ts';

export const sections = [
  'types',
  'config',
  'models',
  'commands',
  'repo',
  'service',
  'runtime',
  'ui',
  'testing',
] as const;

export type PackageOptions = {
  readonly name: string;
  readonly sections: string;
  readonly record?: string;
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
  if (!wanted.includes('types')) {
    throw new Error('A package needs `types/`. It holds the records and the interface.');
  }
  return sections.filter((section) => wanted.includes(section));
}

/**
 * The repo section: drizzle-kit config, an empty migrations folder, the
 * `db-generate` target, and `runtime/migrate.server.ts`, which the server app
 * runs at start. Only drizzle-kit writes a migration.
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
  register(
    tree,
    'apps/api/src/packages.ts',
    `import { migrate${name.className} } from '@repo/${name.fileName}/runtime/migrate.server';`,
    { variable: 'migrations' },
    `migrate${name.className}`,
  );
  addAppDependency(tree, 'apps/api/package.json', `@repo/${name.fileName}`);
}

/** The problems with the chosen sections and record, before any file is written. */
function planProblem(chosen: ReadonlyArray<string>, record: string | undefined) {
  if (chosen.includes('repo') && !chosen.includes('runtime')) {
    return 'A package with `repo/` needs `runtime/`. Its `migrate.server.ts` runs the migrations.';
  }
  if (chosen.includes('repo') && !record) {
    return 'A package with `repo/` owns records. Name the first one with `--record=<name>`.';
  }
  return null;
}

/**
 * Writes a package with only the sections it needs. With `--record`, `types/`
 * gets the record schema, `models/` its model, and `repo/` its table. Each
 * other section starts empty.
 */
export function addPackage(tree: Tree, options: PackageOptions) {
  const name = names(options.name);
  const directory = `packages/${name.fileName}`;
  const chosen = parseSections(options.sections);
  const problem = planProblem(chosen, options.record);
  if (problem) {
    throw new Error(problem);
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
  if (options.record && chosen.includes('models')) {
    addModel(tree, { package: name.fileName, name: options.record });
  } else if (options.record) {
    addRecordSchema(tree, name.fileName, options.record);
  }
  if (chosen.includes('repo') && options.record) {
    addRepo(tree, directory, name);
    addTable(tree, name.fileName, options.record);
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

export function packageGenerator(tree: Tree, options: PackageOptions) {
  addPackage(tree, options);
  return afterWrite(tree, true);
}
