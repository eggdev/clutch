import path from 'node:path';

import type { Tree } from '@nx/devkit';
import { generateFiles, names } from '@nx/devkit';
import { addGate } from '@tools/generators/shared/gates.ts';
import {
  addAppDependency,
  addPrimitive,
  afterWrite,
  clientAppDirectories,
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

/**
 * Registers a data journey as its web flow in the verify config. The native run
 * compiles the same file, so it has no flow of its own. A project without the config is skipped.
 */
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
      artifactPaths: ['test-results/journeys', 'test-results/visual'],
      commands: [journeyCommand(id)],
    },
  };
  tree.write(verificationFile, `${JSON.stringify(config, null, 2)}\n`);
}

/**
 * Writes a feature with its gate, a screen, an empty `components/` and a
 * draft journey, then registers it: a primitive, the gate in the `one-gate`
 * lint options, a route in the client app, and the journey as a verify flow.
 */
export function addFeature(tree: Tree, options: FeatureOptions) {
  const name = names(options.name);
  const directory = `features/${name.fileName}`;
  const title = name.fileName.replaceAll('-', ' ');
  writeProject(tree, {
    directory,
    name: `@features/${name.fileName}`,
    tag: 'type:feature',
    // The screen is made of the components of the design system.
    dependencies: { '@repo/design-system': 'workspace:*', react: versionOf(tree, 'react') },
    // The journey imports the accessibility check from @repo/journeys.
    devDependencies: {
      '@repo/journeys': 'workspace:*',
      '@types/react': versionOf(tree, '@types/react'),
      // The types that give React Native components a `className` prop.
      'react-native-css': versionOf(tree, 'react-native-css'),
    },
    references: ['../../packages/design-system'],
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
  // The route is a file in the first client app that has an `app/` folder (One's file routes).
  const app = clientAppDirectories(tree).find((item) => tree.children(`${item}/app`).length > 0);
  if (app) {
    const route = `${app}/app/${name.fileName}.tsx`;
    addGate(tree, `/${name.fileName}`, `${directory}/gate.ts`, route);
    generateFiles(tree, path.join(import.meta.dirname, 'route'), `${app}/app`, substitutions);
    addAppDependency(tree, `${app}/package.json`, `@features/${name.fileName}`);
  }
}

/** Adds a feature, and returns the step that installs and formats the result. */
export function featureGenerator(tree: Tree, options: FeatureOptions) {
  addFeature(tree, options);
  return afterWrite(tree, true);
}
