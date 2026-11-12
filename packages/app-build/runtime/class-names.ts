import { createRequire } from 'node:module';
import nodePath from 'node:path';

import { splitStyledImports } from '@repo/app-build/runtime/styled-imports.ts';
import type { Plugin } from 'vite';

type Target = 'web' | 'native';

/** The folder of the React Native package that the app installs. */
const nativeRoot = nodePath.dirname(
  createRequire(import.meta.url).resolve('react-native/package.json'),
);

/** An import of `react-native` by name, in any quote style. */
const reactNative = /(\bfrom\s*|\bimport\s*)(['"])react-native\2/gu;

/**
 * Gives React Native's components a `className` prop. Code of this repository
 * that imports `react-native` gets `react-native-css/components`, as
 * NativeWind's Metro resolver does. NativeWind ships that step for Metro only,
 * and One bundles with Vite, so this plugin does it.
 *
 * The swap is a change to the source text. One names `react-native` in an
 * alias, and Vite applies an alias before any plugin resolves an import, so a
 * `resolveId` hook never sees the name.
 *
 * `target` is the bundle. One builds the native bundle with its own plugins,
 * so the config gives it `classNames('native')`.
 */
export function classNames(target: Target = 'web'): Plugin {
  const empty = '\0react-native-css-metro-override';
  return {
    name: 'app-build:class-names',
    enforce: 'pre',
    resolveId(source, importer) {
      // One keeps one copy of React Native in development only. A release
      // bundle must also use the version of the app, for each nested import.
      if (
        target === 'native' &&
        (source === 'react-native' || source.startsWith('react-native/'))
      ) {
        return this.resolve(
          nodePath.join(nativeRoot, source === 'react-native' ? 'index.js' : source.slice(13)),
          importer,
          { skipSelf: true },
        );
      }
      // Metro replaces this module. Without the swap, it throws a setup error.
      if (source.includes('react-native-css-metro-override')) {
        return empty;
      }
      // As the Metro resolver of react-native-css does for each module: its
      // SafeAreaProvider gives the insets to the `*-safe-*` classes.
      if (
        target === 'native' &&
        source === 'react-native-safe-area-context' &&
        !importer?.includes('/node_modules/react-native-css/')
      ) {
        return this.resolve(
          'react-native-css/components/react-native-safe-area-context',
          importer,
          {
            skipSelf: true,
          },
        );
      }
      return null;
    },
    load(id) {
      return id === empty ? 'export {};' : null;
    },
    transform(code, id) {
      const file = id.split('?')[0] ?? '';
      if (file.includes('/node_modules/') || !/\.[jt]sx?$/u.test(file)) {
        return null;
      }
      const swapped = code.replaceAll(reactNative, '$1$2react-native-css/components$2');
      return target === 'web' ? splitStyledImports(swapped) : swapped;
    },
  };
}
