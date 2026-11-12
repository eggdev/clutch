import { readFileSync } from 'node:fs';
import nodePath from 'node:path';

import { chunkModules } from '@repo/app-build/runtime/chunk-modules.ts';
import { classNames } from '@repo/app-build/runtime/class-names.ts';
import { nativeStyles } from '@repo/app-build/runtime/native-styles.ts';
import { styledComponentModules } from '@repo/app-build/runtime/styled-imports.ts';
import tailwindcss from '@tailwindcss/vite';
import { one } from 'one/vite';
import { defineConfig } from 'vite';

const appRoot = import.meta.dirname;

/** The name of the project, which the dev servers carry in their URLs. */
const project: string = JSON.parse(
  readFileSync(nodePath.join(appRoot, '../../package.json'), 'utf-8'),
).name;

/**
 * The API in development. `tools/dev.ts` sets `DEV_API_URL` to the portless
 * URL of the API. A native build starts without it, and gets the same URL by
 * its stable name. The proxy connects to 127.0.0.1 and sends the host name of
 * the API, so portless routes it without a DNS lookup.
 */
const api = new URL(process.env.DEV_API_URL ?? `http://api.${project}.localhost:1355`);

// The native app has no page origin, so its bundle carries the origin of the
// API. A release build names its own. See lib/server.native.ts.
process.env.EXPO_PUBLIC_API_ORIGIN ??= api.origin;

/**
 * `tools/dev.ts` starts the app through portless, which passes the port and
 * the host as `PORT` and `HOST`. One reads neither, so the server takes them here.
 */
const port = process.env.PORT ? Number(process.env.PORT) : undefined;

/**
 * The universal app on One: one set of routes for the web, iOS and Android.
 * Vite bundles all three. The Tailwind plugin styles the web. The two plugins
 * of `@repo/app-build` give React Native components a `className` prop and
 * compile the same classes for the native app.
 */
export default defineConfig({
  server: {
    host: process.env.HOST,
    port,
    strictPort: port !== undefined,
    proxy: {
      '/sync': {
        target: `ws://127.0.0.1:${api.port || '80'}`,
        ws: true,
        headers: { host: api.host },
      },
      '/mcp': {
        target: `http://127.0.0.1:${api.port || '80'}`,
        headers: { host: api.host },
      },
    },
  },
  optimizeDeps: {
    // Vite finds these only when a page first imports them, then bundles
    // again and reloads the page. Bundling them at start avoids the reload.
    include: [...styledComponentModules, '@react-navigation/native'],
  },
  plugins: [
    tailwindcss(),
    classNames(),
    nativeStyles(appRoot),
    // Lists the modules of each chunk, for the first-screen check.
    chunkModules(nodePath.join(appRoot, '../..')),
    one({
      web: {
        // Each route renders in the browser. The root layout, _layout+ssg.tsx,
        // is the one static file: One writes it into each page as the document.
        defaultRenderMode: 'spa',
      },
      // Fills the gaps of Hermes before any route loads.
      setupFile: { native: './native-setup.ts' },
      // React Compiler on the web and on native.
      react: { compiler: true },
      // The native bundler of One runs only the plugins listed here.
      native: {
        bundler: 'vite',
        bundlerOptions: { plugins: [classNames('native'), nativeStyles(appRoot)] },
      },
    }),
  ],
});
