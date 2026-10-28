import path from 'node:path';

import type { Tree } from '@nx/devkit';
import { generateFiles, names, updateJson } from '@nx/devkit';
import { addModel, addRecordSchema } from '@tools/generators/model/generator.ts';
import {
  addDependencies,
  addPrimitive,
  afterWrite,
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
  readonly sections?: string;
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
    throw new Error('A package needs `types/`. It holds the first record and the interface.');
  }
  return sections.filter((section) => wanted.includes(section));
}

/** The repo section: a table for the first record, drizzle-kit config, and the migrations folder. */
function addRepo(tree: Tree, directory: string, record: ReturnType<typeof names>) {
  generateFiles(tree, path.join(import.meta.dirname, 'repo'), directory, {
    ...record,
    title: record.fileName.replaceAll('-', ' '),
    tableName: `${record.propertyName}Records`,
    sqlName: record.fileName.replaceAll('-', '_'),
  });
  addDependencies(tree, directory, { 'drizzle-orm': versionOf(tree, 'drizzle-orm') }, []);
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
}

/**
 * Writes a package with only the sections it needs. `types/` gets the first
 * record. `models/` gets its model. `repo/` gets its table and an empty
 * migrations folder. Each other section starts empty.
 */
export function addPackage(tree: Tree, options: PackageOptions) {
  const name = names(options.name);
  const directory = `packages/${name.fileName}`;
  const chosen = parseSections(options.sections ?? 'types,models,commands,runtime,ui,testing');
  const record = names(options.record ?? options.name);
  writeProject(tree, {
    directory,
    name: `@repo/${name.fileName}`,
    tag: 'type:package',
    dependencies: { effect: versionOf(tree, 'effect') },
    references: [],
  });
  const title = name.fileName.replaceAll('-', ' ');
  generateFiles(tree, path.join(import.meta.dirname, 'files'), directory, {
    heading: `${title.charAt(0).toUpperCase()}${title.slice(1)}`,
    summary: options.summary ?? 'Say what this package owns.',
    sectionList: chosen.map((section) => `\`${section}/\``).join(', '),
  });
  if (chosen.includes('models')) {
    addModel(tree, { package: name.fileName, name: record.fileName });
  } else {
    addRecordSchema(tree, name.fileName, record.fileName);
  }
  if (chosen.includes('repo')) {
    addRepo(tree, directory, record);
  }
  for (const section of chosen) {
    if (!['types', 'models', 'repo'].includes(section)) {
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
