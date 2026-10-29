import path from 'node:path';

import type { Tree } from '@nx/devkit';
import { generateFiles, names } from '@nx/devkit';
import { ensureList } from '@tools/generators/command/generator.ts';
import {
  addAppDependency,
  addDependencies,
  afterWrite,
  register,
  versionOf,
} from '@tools/generators/shared/workspace.ts';

export type JobOptions = { readonly package: string; readonly name: string };

/**
 * Writes a job in `jobs/<name>.ts` and registers it: in the package's
 * `runtime/jobs.server.ts`, and once for the package in the server app's job
 * list. A server change asks for the job through the outbox.
 */
export function addJob(tree: Tree, options: JobOptions) {
  const directory = `packages/${options.package}`;
  const name = names(options.name);
  if (!tree.exists(`${directory}/package.json`)) {
    throw new Error(`${directory} does not exist. Run the package generator first.`);
  }
  if (tree.exists(`${directory}/jobs/${name.fileName}.ts`)) {
    throw new Error(`${directory}/jobs/${name.fileName}.ts already exists.`);
  }
  generateFiles(tree, path.join(import.meta.dirname, 'files'), directory, {
    ...name,
    packageName: options.package,
  });
  if (tree.exists(`${directory}/jobs/.gitkeep`)) {
    tree.delete(`${directory}/jobs/.gitkeep`);
  }
  addDependencies(
    tree,
    directory,
    { '@repo/sync': 'workspace:*', effect: versionOf(tree, 'effect') },
    ['../sync'],
  );
  const list = `${names(options.package).propertyName}Jobs`;
  const file = `${directory}/runtime/jobs.server.ts`;
  const isNew = !tree.exists(file);
  ensureList(tree, file, list, 'jobs');
  register(
    tree,
    file,
    `import { ${name.propertyName} } from '@repo/${options.package}/jobs/${name.fileName}';`,
    { variable: list },
    name.propertyName,
  );
  if (isNew) {
    register(
      tree,
      'apps/api/src/packages.ts',
      `import { ${list} } from '@repo/${options.package}/runtime/jobs.server';`,
      { variable: 'jobs' },
      `...${list}`,
    );
  }
  addAppDependency(tree, 'apps/api/package.json', `@repo/${options.package}`);
}

export function jobGenerator(tree: Tree, options: JobOptions) {
  addJob(tree, options);
  return afterWrite(tree, true);
}
