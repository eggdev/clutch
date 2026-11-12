import { readFile, writeFile } from 'node:fs/promises';
import nodePath from 'node:path';

import tailwindPostcss from '@tailwindcss/postcss';
import postcss, { atRule, parse } from 'postcss';
import type { Plugin as PostcssPlugin } from 'postcss';
import { compile } from 'react-native-css/compiler';
import type { Plugin } from 'vite';

/** The module that the native app imports to get the compiled styles. */
const nativeStylesModule = 'virtual:native-styles';

/**
 * React Native has no root element to carry the `dark` class, so the native
 * build reads the `.dark` block of the token file as the dark color scheme.
 */
const darkAsColorScheme: PostcssPlugin = {
  postcssPlugin: 'app-build:dark-as-color-scheme',
  Once(root) {
    root.walkRules('.dark', (rule) => {
      if (rule.parent?.type !== 'root') {
        return;
      }
      const media = atRule({ name: 'media', params: '(prefers-color-scheme: dark)' });
      rule.replaceWith(media);
      media.append(rule.clone({ selector: ':root' }));
    });
  },
};

/**
 * The first class or token that mixes colors, or nothing. react-native-css
 * works out `color-mix()` at run time and gets it wrong, and an opacity
 * modifier, a slash and a number after a color class, compiles to one. The
 * web draws both right, so only this compile can catch one.
 *
 * Tailwind reads each file of `packages/` and `features/` as text, also a
 * comment or a test. So no file there spells such a class out, or Tailwind
 * makes the class and this compile stops.
 */
export function mixedColor(css: string): string | undefined {
  let found: string | undefined;
  parse(css).walkDecls((decl) => {
    const rule = decl.parent;
    if (found || !decl.value.includes('color-mix(') || rule?.type !== 'rule') {
      return;
    }
    // A class of this repository, or a token. The reset of Tailwind is neither.
    if ('selector' in rule && /^(?:\.|:root)/u.test(rule.selector)) {
      found = `${rule.selector} { ${decl.prop}: ${decl.value} }`;
    }
  });
  return found;
}

/** Compiles the Tailwind entry of the app to the stylesheet of react-native-css, as JSON. */
async function compileNativeStyles(appRoot: string): Promise<string> {
  const from = nodePath.join(appRoot, 'global.css');
  const { css } = await postcss([tailwindPostcss({ base: appRoot }), darkAsColorScheme]).process(
    await readFile(from, 'utf-8'),
    { from },
  );
  const mixed = mixedColor(css);
  if (mixed) {
    throw new Error(
      `A style mixes colors, which the native app draws wrong: ${mixed}. Use a role color of the token file in place of an opacity modifier or \`color-mix()\`.`,
    );
  }
  // The token file is in rem, and a device draws 1 rem as 16 px, as a browser does by default.
  return JSON.stringify(
    compile(css, { filename: from, projectRoot: appRoot, inlineRem: 16 }).stylesheet(),
  );
}

/**
 * Compiles `global.css` of the app through Tailwind and react-native-css into
 * `lib/native-styles.generated.json`, because the native bundler of One drops
 * each CSS import. The native app imports the file as `virtual:native-styles`
 * and registers it before the first render. The web reads the CSS itself.
 */
export function nativeStyles(appRoot: string): Plugin {
  const output = nodePath.join(appRoot, 'lib/native-styles.generated.json');
  let timer: ReturnType<typeof setTimeout> | undefined;
  async function write() {
    const data = await compileNativeStyles(appRoot);
    const previous = await readFile(output, 'utf-8').catch(() => '');
    if (previous !== data) {
      await writeFile(output, data);
    }
  }
  /** Compiles again after a source change. A failed compile logs, and the next change tries again. */
  async function rewrite() {
    try {
      await write();
    } catch (error) {
      console.error(error);
    }
  }
  return {
    name: 'app-build:native-styles',
    resolveId(source) {
      return source === nativeStylesModule ? output : null;
    },
    async buildStart() {
      await write();
    },
    configureServer(server) {
      server.watcher.on('change', (file) => {
        if (!/\.(?:tsx?|css)$/u.test(file) || file.endsWith('.generated.json')) {
          return;
        }
        clearTimeout(timer);
        timer = setTimeout(() => {
          void rewrite();
        }, 200);
      });
    },
  };
}
