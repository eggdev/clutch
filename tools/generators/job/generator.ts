import path from 'node:path';

import type { Tree } from '@nx/devkit';
import { generateFiles, names } from '@nx/devkit';
import {
  addToArray,
  declaresConstant,
  insertBeforeContract,
  mergeNamedImport,
} from '@tools/generators/shared/registry.ts';
import {
  addAppDependency,
  addDependencies,
  afterWrite,
  ensureFile,
  register,
  versionOf,
} from '@tools/generators/shared/workspace.ts';

export type JobOptions = { readonly package: string; readonly name: string };

/** The contract declaration of a job: its name and the fields of its payload. */
function declarationOf(packageName: string, fileName: string, propertyName: string) {
  return [
    '/** Say what the job does, and what its payload holds. */',
    `export const ${propertyName}Job = job('${packageName}/${fileName}', { payload: {} });`,
    '',
  ].join('\n');
}

/**
 * Writes a job in `jobs/<name>.ts` and declares it in the package contract,
 * with its payload. The job's code is `defineJob(declaration, run)`, and the
 * package's `runtime/server.server.ts` lists it in `jobs`. The server app lists
 * the package through `packages`. A server change asks for the job through the outbox.
 */
export function addJob(tree: Tree, options: JobOptions) {
  const directory = `packages/${options.package}`;
  const name = names(options.name);
  const contractFile = `${directory}/contract/${options.package}.ts`;
  if (!tree.exists(`${directory}/package.json`)) {
    throw new Error(`${directory} does not exist. Run the package generator first.`);
  }
  if (!tree.exists(contractFile)) {
    throw new Error(
      `${contractFile} does not exist. Run \`nx g @tools/generators:package ${options.package} --sections=contract\` first.`,
    );
  }
  if (tree.exists(`${directory}/jobs/${name.fileName}.ts`)) {
    throw new Error(`${directory}/jobs/${name.fileName}.ts already exists.`);
  }
  let source = tree.read(contractFile, 'utf-8') ?? '';
  if (declaresConstant(source, `${name.propertyName}Job`)) {
    throw new Error(
      `${contractFile} already declares \`${name.propertyName}Job\`. Choose another name.`,
    );
  }
  source = insertBeforeContract(
    source,
    declarationOf(options.package, name.fileName, name.propertyName),
  );
  source = mergeNamedImport(source, '@repo/sync/contract/job', ['job'], false);
  source = addToArray(source, { property: 'jobs' }, `${name.propertyName}Job`);
  tree.write(contractFile, source);
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
  const contract = `${names(options.package).propertyName}Contract`;
  const file = `${directory}/runtime/server.server.ts`;
  ensureFile(
    tree,
    file,
    [
      `import { ${contract} } from '@repo/${options.package}/contract/${options.package}';`,
      "import { serverPackage } from '@repo/sync/service/server-package.server';",
      '',
      '/** The server half of this package. The server app lists it in `packages`. */',
      `export const ${names(options.package).propertyName}Server = serverPackage(${contract}, { changes: [], jobs: [], routes: [] });`,
      '',
    ].join('\n'),
  );
  register(
    tree,
    file,
    `import { ${name.propertyName} } from '@repo/${options.package}/jobs/${name.fileName}';`,
    { property: 'jobs' },
    name.propertyName,
  );
  addAppDependency(tree, 'apps/api/package.json', `@repo/${options.package}`);
}

/** Adds a job to a package, and returns the step that installs and formats the result. */
export function jobGenerator(tree: Tree, options: JobOptions) {
  addJob(tree, options);
  return afterWrite(tree, true);
}
