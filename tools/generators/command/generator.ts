import path from 'node:path';

import type { Tree } from '@nx/devkit';
import { generateFiles, names } from '@nx/devkit';
import {
  addDependencies,
  afterWrite,
  register,
  versionOf,
} from '@tools/generators/shared/workspace.ts';

export type CommandOptions = {
  readonly package: string;
  readonly name: string;
  readonly model: string;
  readonly waits: 'local' | 'server';
};

/** Creates an empty registration list for one half of the package's commands. */
function ensureList(tree: Tree, file: string, list: string, half: 'client' | 'server') {
  if (tree.exists(file)) {
    return;
  }
  const where =
    half === 'client'
      ? 'The client half of each command. The web app gives them to the object pool.'
      : 'The server change of each command. The server app passes them to `SyncServer`.';
  tree.write(file, `/** ${where} */\nexport const ${list} = [];\n`);
}

function addAppDependency(tree: Tree, file: string, dependency: string) {
  const source = tree.read(file, 'utf-8');
  if (source === null) {
    return;
  }
  const manifest = JSON.parse(source);
  manifest.dependencies = { ...manifest.dependencies, [dependency]: 'workspace:*' };
  tree.write(file, `${JSON.stringify(manifest, null, 2)}\n`);
}

/**
 * Writes a command as paired files, its input schema, and both registrations:
 * the client half in `runtime/commands.ts`, the server half in
 * `runtime/handlers.server.ts`. The apps' registration files get the package
 * lists once.
 */
export function addCommand(tree: Tree, options: CommandOptions) {
  const directory = `packages/${options.package}`;
  const name = names(options.name);
  const model = names(options.model);
  if (!tree.exists(`${directory}/models/${model.fileName}.ts`)) {
    throw new Error(
      `${directory}/models/${model.fileName}.ts does not exist. Run \`nx g @tools/generators:model ${options.package} ${model.fileName}\` first.`,
    );
  }
  if (tree.exists(`${directory}/commands/${name.fileName}.ts`)) {
    throw new Error(`${directory}/commands/${name.fileName}.ts already exists.`);
  }
  generateFiles(tree, path.join(import.meta.dirname, 'files'), directory, {
    ...name,
    packageName: options.package,
    modelFile: model.fileName,
    modelProperty: model.propertyName,
    waits: options.waits,
  });
  addDependencies(
    tree,
    directory,
    { '@repo/sync': 'workspace:*', effect: versionOf(tree, 'effect') },
    ['../sync'],
  );
  const lists = names(options.package).propertyName;
  ensureList(tree, `${directory}/runtime/commands.ts`, `${lists}Commands`, 'client');
  ensureList(tree, `${directory}/runtime/handlers.server.ts`, `${lists}ServerChanges`, 'server');
  register(
    tree,
    `${directory}/runtime/commands.ts`,
    `import { ${name.propertyName} } from '@repo/${options.package}/commands/${name.fileName}';`,
    { variable: `${lists}Commands` },
    name.propertyName,
  );
  register(
    tree,
    `${directory}/runtime/handlers.server.ts`,
    `import { ${name.propertyName}Server } from '@repo/${options.package}/commands/${name.fileName}.server';`,
    { variable: `${lists}ServerChanges` },
    `${name.propertyName}Server`,
  );
  register(
    tree,
    'apps/web/src/commands.ts',
    `import { ${lists}Commands } from '@repo/${options.package}/runtime/commands';`,
    { variable: 'commands' },
    `...${lists}Commands`,
  );
  register(
    tree,
    'apps/api/src/packages.ts',
    `import { ${lists}ServerChanges } from '@repo/${options.package}/runtime/handlers.server';`,
    { variable: 'serverChanges' },
    `...${lists}ServerChanges`,
  );
  addAppDependency(tree, 'apps/web/package.json', `@repo/${options.package}`);
  addAppDependency(tree, 'apps/api/package.json', `@repo/${options.package}`);
}

export function commandGenerator(tree: Tree, options: CommandOptions) {
  addCommand(tree, options);
  return afterWrite(tree, true);
}
