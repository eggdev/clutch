import { expect, test } from 'bun:test';

import {
  precacheList,
  serviceWorkerSource,
  syncChunks,
  syncChunksMarker,
  withSyncChunks,
} from '@tools/web/service-worker';
import type { Manifest } from '@tools/web/service-worker';

const manifest: Manifest = {
  'index.html': {
    file: 'assets/index-a.js',
    src: 'index.html',
    isEntry: true,
    imports: ['_react-b.js'],
    dynamicImports: ['../../packages/sync/runtime/transport.ts'],
    css: ['assets/index-c.css'],
    assets: ['assets/font-d.woff2'],
  },
  '_react-b.js': { file: 'assets/react-b.js' },
  '../../packages/sync/runtime/transport.ts': {
    file: 'assets/transport-e.js',
    src: '../../packages/sync/runtime/transport.ts',
    isDynamicEntry: true,
    imports: ['_effect-f.js', '_react-b.js'],
  },
  '_effect-f.js': { file: 'assets/effect-f.js' },
};

/** The cache name that a generated worker uses. */
const cacheNameOf = (source: string) => /const cacheName = '([^']+)'/u.exec(source)?.[1];

test('the precache list holds the page and every file of the build, once each', () => {
  expect(precacheList(manifest)).toEqual([
    '/',
    '/assets/effect-f.js',
    '/assets/font-d.woff2',
    '/assets/index-a.js',
    '/assets/index-c.css',
    '/assets/react-b.js',
    '/assets/transport-e.js',
    '/index.html',
  ]);
});

test('the sync chunks are the transport and its imports, without first-screen chunks', () => {
  expect(syncChunks(manifest)).toEqual(['/assets/effect-f.js', '/assets/transport-e.js']);
});

test('a new build gets a new cache name, and the worker caches the list it was given', () => {
  const one = serviceWorkerSource(['/', '/assets/a.js']);
  const two = serviceWorkerSource(['/', '/assets/b.js']);
  expect(cacheNameOf(one)).not.toBe(cacheNameOf(two));
  expect(one).toContain('const urls = ["/","/assets/a.js"]');
});

test('the build writes the sync chunks into the boot script, and needs the marker', () => {
  const html = `<script>${syncChunksMarker}</script>`;
  expect(withSyncChunks(html, ['/assets/transport-e.js'])).toBe(
    '<script>const syncChunks = ["/assets/transport-e.js"];</script>',
  );
  expect(() => withSyncChunks('<script></script>', [])).toThrow('Restore it from the template');
});
