import path from 'node:path';

import type { Tree } from '@nx/devkit';
import { generateFiles, names } from '@nx/devkit';
import { addDependencies, afterWrite, versionOf } from '@tools/generators/shared/workspace.ts';

export type ModelOptions = { readonly package: string; readonly name: string };

/**
 * Writes a record schema in `types/` and its model in `models/`. The schema is
 * hand-written, so the storage shape never becomes the interface.
 */
/** Writes only the record schema in `types/`, for a package without `models/`. */
export function addRecordSchema(tree: Tree, packageName: string, record: string) {
  const directory = `packages/${packageName}`;
  const name = names(record);
  generateFiles(tree, path.join(import.meta.dirname, 'files', 'types'), `${directory}/types`, {
    ...name,
    packageName,
    title: name.fileName.replaceAll('-', ' '),
  });
  addDependencies(tree, directory, { effect: versionOf(tree, 'effect') }, []);
}

export function addModel(tree: Tree, options: ModelOptions) {
  const directory = `packages/${options.package}`;
  if (!tree.exists(`${directory}/package.json`)) {
    throw new Error(`${directory} does not exist. Run \`nx g @tools/generators:package\` first.`);
  }
  const name = names(options.name);
  if (tree.exists(`${directory}/types/${name.fileName}.ts`)) {
    throw new Error(`${directory}/types/${name.fileName}.ts already exists.`);
  }
  generateFiles(tree, path.join(import.meta.dirname, 'files'), directory, {
    ...name,
    packageName: options.package,
    title: name.fileName.replaceAll('-', ' '),
  });
  addDependencies(
    tree,
    directory,
    { '@repo/sync': 'workspace:*', effect: versionOf(tree, 'effect') },
    ['../sync'],
  );
}

export function modelGenerator(tree: Tree, options: ModelOptions) {
  addModel(tree, options);
  return afterWrite(tree, true);
}
