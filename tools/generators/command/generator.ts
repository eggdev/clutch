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
  clientAppDirectories,
  ensureFile,
  register,
  versionOf,
} from '@tools/generators/shared/workspace.ts';

export type CommandOptions = {
  readonly package: string;
  readonly name: string;
  /** The record that the command writes, such as `invoice`. Its record must be in the contract. */
  readonly record: string;
  readonly waits: 'local' | 'server';
  readonly access: 'organization' | 'group';
};

/** The contract declaration of a command: what it changes, who runs it and how it is refused. */
function declarationOf(options: CommandOptions, fileName: string, propertyName: string) {
  return [
    '/** Say what the command changes, who may run it and how it can be refused. */',
    `export const ${propertyName} = command('${options.package}/${fileName}', {`,
    "  input: { id: 'string', at: 'now' },",
    `  waits: '${options.waits}',`,
    `  access: '${options.access}',`,
    '  refuses: [],',
    "  tool: 'none',",
    '});',
    '',
  ].join('\n');
}

/** The first version of `runtime/client.ts`: the package's client half, with an empty list of local changes. */
function clientRegistration(packageName: string) {
  const base = names(packageName).propertyName;
  return [
    `import { ${base}Contract } from '@repo/${packageName}/contract/${packageName}';`,
    "import { clientPackage } from '@repo/sync/contract/define';",
    '',
    '/** The client half of this package. The client apps list it in `packages`. */',
    `export const ${base}Client = clientPackage(${base}Contract, []);`,
    '',
  ].join('\n');
}

/** The first version of `runtime/server.server.ts`: the package's server half, with empty lists. */
function serverRegistration(packageName: string) {
  const base = names(packageName).propertyName;
  return [
    `import { ${base}Contract } from '@repo/${packageName}/contract/${packageName}';`,
    "import { serverPackage } from '@repo/sync/service/server-package.server';",
    '',
    '/** The server half of this package. The server app lists it in `packages`. */',
    `export const ${base}Server = serverPackage(${base}Contract, { changes: [], jobs: [], routes: [] });`,
    '',
  ].join('\n');
}

/**
 * Declares a command in the package contract, then writes its server half in
 * `commands/<name>.server.ts`. A command that shows at once also gets its
 * local change in `commands/<name>.ts`. Both registrations list it: the local
 * change in `runtime/client.ts`, the server change in `runtime/server.server.ts`.
 */
export function addCommand(tree: Tree, options: CommandOptions) {
  const directory = `packages/${options.package}`;
  const contractFile = `${directory}/contract/${options.package}.ts`;
  const name = names(options.name);
  const record = names(options.record);
  const recordProperty = `${record.propertyName}Record`;
  if (!tree.exists(contractFile)) {
    throw new Error(
      `${contractFile} does not exist. Run \`nx g @tools/generators:package ${options.package} --sections=contract,commands\` first.`,
    );
  }
  let source = tree.read(contractFile, 'utf-8') ?? '';
  if (!declaresConstant(source, recordProperty)) {
    throw new Error(
      `${contractFile} does not declare \`${recordProperty}\`. Run \`nx g @tools/generators:record ${options.package} ${record.fileName} --group=<group>\` first.`,
    );
  }
  if (declaresConstant(source, name.propertyName)) {
    throw new Error(
      `${contractFile} already declares \`${name.propertyName}\`. Choose another name.`,
    );
  }
  const taken = [
    `${directory}/commands/${name.fileName}.server.ts`,
    `${directory}/commands/${name.fileName}.ts`,
  ].find((file) => tree.exists(file));
  if (taken) {
    throw new Error(`${taken} already exists. Choose another name.`);
  }

  source = insertBeforeContract(source, declarationOf(options, name.fileName, name.propertyName));
  source = mergeNamedImport(source, '@repo/sync/contract/command', ['command'], false);
  source = addToArray(source, { property: 'commands' }, name.propertyName);
  tree.write(contractFile, source);

  generateFiles(tree, path.join(import.meta.dirname, 'files'), directory, {
    ...name,
    packageName: options.package,
    access: options.access,
  });
  if (options.waits === 'local') {
    generateFiles(tree, path.join(import.meta.dirname, 'local'), `${directory}/commands`, {
      ...name,
      packageName: options.package,
      recordProperty: record.propertyName,
    });
  }
  addDependencies(
    tree,
    directory,
    { '@repo/sync': 'workspace:*', effect: versionOf(tree, 'effect') },
    ['../sync'],
  );
  ensureFile(tree, `${directory}/runtime/client.ts`, clientRegistration(options.package));
  ensureFile(tree, `${directory}/runtime/server.server.ts`, serverRegistration(options.package));
  if (options.waits === 'local') {
    register(
      tree,
      `${directory}/runtime/client.ts`,
      `import { ${name.propertyName}Local } from '@repo/${options.package}/commands/${name.fileName}';`,
      { callee: 'clientPackage' },
      `${name.propertyName}Local`,
    );
  }
  register(
    tree,
    `${directory}/runtime/server.server.ts`,
    `import { ${name.propertyName}Server } from '@repo/${options.package}/commands/${name.fileName}.server';`,
    { property: 'changes' },
    `${name.propertyName}Server`,
  );
  for (const app of [...clientAppDirectories(tree), 'apps/api']) {
    addAppDependency(tree, `${app}/package.json`, `@repo/${options.package}`);
  }
}

/** Adds a command to a package, and returns the step that installs and formats the result. */
export function commandGenerator(tree: Tree, options: CommandOptions) {
  addCommand(tree, options);
  return afterWrite(tree, true);
}
