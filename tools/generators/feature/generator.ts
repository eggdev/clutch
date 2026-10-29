import path from 'node:path';

import type { Tree } from '@nx/devkit';
import { generateFiles, names } from '@nx/devkit';
import { addGate } from '@tools/generators/shared/gates.ts';
import {
  addPrimitive,
  afterWrite,
  register,
  versionOf,
  writeProject,
} from '@tools/generators/shared/workspace.ts';

export type FeatureOptions = { readonly name: string };

/**
 * The verify config, and the flow command that runs a journey. Nx loads a
 * generator on its own, so these repeat `tools/journeys/journeys.ts`. The
 * generator test runs `check-journeys` on the result.
 */
const verificationFile = '.agents/skills/verify/verification.json';
const journeyCommand = (id: string) => ['mise', 'exec', '--', 'bun', 'run', 'journey', id];

/** Registers a web journey as a flow in the verify config. A project without one is skipped. */
function addJourneyFlow(tree: Tree, id: string) {
  const source = tree.read(verificationFile, 'utf-8');
  if (source === null) {
    return;
  }
  const config = JSON.parse(source);
  config.flows = {
    ...config.flows,
    [id]: {
      platform: 'web',
      role: 'the dev actor in one browser context, against the dev servers',
      ownsStack: true,
      timeoutSeconds: 300,
      artifactPaths: ['test-results/journeys'],
      commands: [journeyCommand(id)],
    },
  };
  tree.write(verificationFile, `${JSON.stringify(config, null, 2)}\n`);
}

/**
 * Writes a feature with its gate, a screen, an empty `components/` and a
 * draft journey, then registers it: a primitive, the gate in the `one-gate`
 * lint options, a route in the web app, and the journey as a verify flow.
 */
export function addFeature(tree: Tree, options: FeatureOptions) {
  const name = names(options.name);
  const directory = `features/${name.fileName}`;
  const title = name.fileName.replaceAll('-', ' ');
  writeProject(tree, {
    directory,
    name: `@features/${name.fileName}`,
    tag: 'type:feature',
    dependencies: { react: versionOf(tree, 'react') },
    devDependencies: { '@types/react': versionOf(tree, '@types/react') },
    references: [],
    react: true,
  });
  const substitutions = {
    ...name,
    title,
    heading: `${title.charAt(0).toUpperCase()}${title.slice(1)}`,
  };
  generateFiles(tree, path.join(import.meta.dirname, 'files'), directory, substitutions);
  addPrimitive(tree, {
    id: `${name.fileName}-feature`,
    group: 'product',
    name: `${substitutions.heading} feature`,
    kind: 'feature',
    summary: `The ${title} screen and its gate.`,
    code: [`${directory}/`],
    docs: ['docs/principles/one-gate-per-feature.md'],
  });
  addJourneyFlow(tree, `${name.fileName}-open`);
  const routes = `apps/web/src/routes/${name.fileName}`;
  addGate(tree, `/${name.fileName}`, `${directory}/gate.ts`, routes);
  if (tree.exists('apps/web/src/router.ts')) {
    generateFiles(tree, path.join(import.meta.dirname, 'route'), routes, substitutions);
    register(
      tree,
      'apps/web/src/router.ts',
      `import { ${name.propertyName}Route } from '@/routes/${name.fileName}/route';`,
      { call: 'addChildren' },
      `${name.propertyName}Route`,
    );
    const manifest = JSON.parse(tree.read('apps/web/package.json', 'utf-8') ?? '{}');
    manifest.dependencies = {
      ...manifest.dependencies,
      [`@features/${name.fileName}`]: 'workspace:*',
    };
    tree.write('apps/web/package.json', `${JSON.stringify(manifest, null, 2)}\n`);
  }
}

export function featureGenerator(tree: Tree, options: FeatureOptions) {
  addFeature(tree, options);
  return afterWrite(tree, true);
}
