import { execFileSync } from 'node:child_process';

import type { Tree } from '@nx/devkit';
import { installPackagesTask, readJson, updateJson, writeJson } from '@nx/devkit';
import type { ArrayTarget } from '@tools/generators/shared/registry.ts';
import { addImport, addToArray } from '@tools/generators/shared/registry.ts';
import { parseDocument } from 'yaml';

const registryFile = 'docs/contributing/architecture/primitives.yaml';

/** The version of an installed dependency, so a new project pins the same one. */
export function versionOf(tree: Tree, name: string): string {
  const file = `node_modules/${name}/package.json`;
  if (!tree.exists(file)) {
    throw new Error(`${name} is not installed. Run \`mise exec -- bun install\`, then run again.`);
  }
  return readJson<{ version: string }>(tree, file).version;
}

/** Adds one primitive at the end of the registry. The comments in the file stay. */
export function addPrimitive(tree: Tree, entry: Record<string, unknown>) {
  const source = tree.read(registryFile, 'utf-8');
  if (source === null) {
    throw new Error(`${registryFile} is missing. Restore it from Clutch.`);
  }
  const document = parseDocument(source);
  const ids = (document.toJS().primitives ?? []).map((primitive: { id: string }) => primitive.id);
  if (ids.includes(entry.id)) {
    throw new Error(`${registryFile} already has the primitive \`${String(entry.id)}\`.`);
  }
  const node = document.createNode(entry);
  node.spaceBefore = true;
  document.addIn(['primitives'], node);
  tree.write(registryFile, document.toString({ lineWidth: 0 }));
}

type Project = {
  readonly directory: string;
  readonly name: string;
  readonly tag: 'type:package' | 'type:feature';
  readonly dependencies: Record<string, string>;
  readonly devDependencies?: Record<string, string>;
  readonly references: ReadonlyArray<string>;
  /** Whether the project holds `.tsx` files, so its tsconfig names the React JSX runtime. */
  readonly react: boolean;
};

/** The package.json and the three tsconfig files of a new package or feature. */
export function writeProject(tree: Tree, project: Project) {
  if (tree.exists(`${project.directory}/package.json`)) {
    throw new Error(`${project.directory} already exists. Choose another name.`);
  }
  writeJson(tree, `${project.directory}/package.json`, {
    name: project.name,
    private: true,
    type: 'module',
    dependencies: project.dependencies,
    ...(project.devDependencies ? { devDependencies: project.devDependencies } : {}),
    nx: {
      tags: [project.tag],
      targets: {
        test: {
          executor: 'nx:run-commands',
          options: {
            command: `bun tools/test-budget.ts 60 -- bun test ${project.directory} --pass-with-no-tests`,
          },
        },
      },
    },
  });
  const compilerOptions = {
    lib: ['es2024', 'dom', 'dom.iterable'],
    ...(project.react ? { jsx: 'react-jsx' } : {}),
  };
  // A feature's journeys run in Playwright, so the spec config checks them.
  const journeys = project.tag === 'type:feature';
  writeJson(tree, `${project.directory}/tsconfig.json`, {
    extends: '../../tsconfig.base.json',
    // knip reads the JSX runtime here to see that a `.tsx` file uses React.
    ...(project.react ? { compilerOptions: { jsx: 'react-jsx', jsxImportSource: 'react' } } : {}),
    files: [],
    references: [{ path: './tsconfig.lib.json' }, { path: './tsconfig.spec.json' }],
  });
  writeJson(tree, `${project.directory}/tsconfig.lib.json`, {
    extends: '../../tsconfig.base.json',
    compilerOptions: {
      outDir: 'out-tsc/lib',
      tsBuildInfoFile: 'out-tsc/lib/tsconfig.lib.tsbuildinfo',
      ...compilerOptions,
      types: [],
    },
    include: ['**/*.ts', '**/*.tsx'],
    exclude: [
      '**/*.test.ts',
      '**/*.test.tsx',
      'testing/**',
      ...(journeys ? ['journeys/**'] : []),
      'out-tsc/**',
      'node_modules/**',
    ],
    references: project.references.map((reference) => ({ path: `${reference}/tsconfig.lib.json` })),
  });
  writeJson(tree, `${project.directory}/tsconfig.spec.json`, {
    extends: '../../tsconfig.base.json',
    compilerOptions: {
      outDir: 'out-tsc/spec',
      tsBuildInfoFile: 'out-tsc/spec/tsconfig.spec.tsbuildinfo',
      types: ['bun'],
      ...compilerOptions,
    },
    include: [
      '**/*.test.ts',
      '**/*.test.tsx',
      'testing/**/*.ts',
      'testing/**/*.tsx',
      ...(journeys ? ['journeys/**/*.pw.ts'] : []),
    ],
    exclude: ['out-tsc/**', 'node_modules/**'],
    references: [{ path: './tsconfig.lib.json' }],
  });
}

/** Adds workspace dependencies and their tsconfig references to an existing project. */
export function addDependencies(
  tree: Tree,
  directory: string,
  dependencies: Record<string, string>,
  references: ReadonlyArray<string>,
) {
  updateJson(tree, `${directory}/package.json`, (manifest) => ({
    ...manifest,
    dependencies: { ...manifest.dependencies, ...dependencies },
  }));
  updateJson(tree, `${directory}/tsconfig.lib.json`, (config) => {
    const known = new Set((config.references ?? []).map((item: { path: string }) => item.path));
    const added = references
      .map((reference) => `${reference}/tsconfig.lib.json`)
      .filter((reference) => !known.has(reference))
      .map((reference) => ({ path: reference }));
    return { ...config, references: [...(config.references ?? []), ...added] };
  });
}

/** Adds a workspace dependency to an app. A project without that app is skipped. */
export function addAppDependency(tree: Tree, file: string, dependency: string) {
  const source = tree.read(file, 'utf-8');
  if (source === null) {
    return;
  }
  const manifest = JSON.parse(source);
  manifest.dependencies = { ...manifest.dependencies, [dependency]: 'workspace:*' };
  tree.write(file, `${JSON.stringify(manifest, null, 2)}\n`);
}

/**
 * Adds an import and one array element to a registration file. A file that
 * does not exist is skipped: a project without that app has nothing to wire.
 */
export function register(
  tree: Tree,
  file: string,
  importLine: string,
  target: ArrayTarget,
  element: string,
) {
  const source = tree.read(file, 'utf-8');
  if (source === null) {
    return;
  }
  tree.write(file, addToArray(addImport(source, importLine), target, element));
}

/**
 * The work after the files are written: install the workspace links, sync the
 * tsconfig references, then format each changed file with the repository
 * formatter, so the result passes `format-check` as generated.
 */
export function afterWrite(tree: Tree, install: boolean) {
  const files = tree
    .listChanges()
    .filter((change) => change.type !== 'DELETE')
    .map((change) => change.path);
  return () => {
    if (install) {
      installPackagesTask(tree, true);
    }
    // Nx writes the tsconfig references of each project that imports the new one.
    execFileSync('bun', ['x', 'nx', 'sync'], { cwd: tree.root, stdio: 'inherit' });
    execFileSync('bun', ['x', 'oxfmt', ...files, 'tsconfig.json', 'apps'], {
      cwd: tree.root,
      stdio: 'inherit',
    });
  };
}
