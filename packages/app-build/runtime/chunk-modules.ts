import nodePath from 'node:path';

import type { Plugin } from 'vite';

/** The file that lists the source modules of each built chunk. It sits beside the manifest of Vite. */
const chunkModulesFile = '.vite/chunk-modules.json';

/**
 * Writes the source modules of each chunk of the web build, as paths from the
 * repository root. The first-screen check counts the modules of each page from
 * this list: One builds with no source maps, so nothing else names them. See
 * tools/check-bundle.ts.
 */
export function chunkModules(repoRoot: string): Plugin {
  return {
    name: 'app-build:chunk-modules',
    applyToEnvironment: (environment) => environment.name === 'client',
    generateBundle(_options, bundle) {
      const chunks: Record<string, Array<string>> = {};
      for (const [file, output] of Object.entries(bundle)) {
        if (output.type === 'chunk') {
          chunks[file] = output.moduleIds
            // A virtual module of a plugin has no file, and holds no code of the app.
            .filter((id) => nodePath.isAbsolute(id))
            .map((id) => nodePath.relative(repoRoot, id.split('?')[0] ?? id))
            .toSorted();
        }
      }
      this.emitFile({
        type: 'asset',
        fileName: chunkModulesFile,
        source: `${JSON.stringify(chunks, null, 2)}\n`,
      });
    },
  };
}
