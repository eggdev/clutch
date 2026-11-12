import { expect, test } from 'bun:test';

import { inRepo } from '@tools/testing/in-repo';
import {
  builtFiles,
  pageFor,
  precacheList,
  serviceWorkerSource,
  syncChunks,
  syncChunksMarker,
  withSyncChunks,
} from '@tools/web/service-worker';
import type { Manifest } from '@tools/web/service-worker';

const manifest: Manifest = {
  'virtual:entry': {
    file: 'assets/entry-a.js',
    imports: ['_react-b.js'],
  },
  '_react-b.js': { file: 'assets/react-b.js' },
  '../../packages/sync/runtime/transport.ts': {
    file: 'assets/transport-e.js',
    isDynamicEntry: true,
    imports: ['_effect-f.js', '_react-b.js'],
  },
  '_effect-f.js': { file: 'assets/effect-f.js' },
};

/** A built page that loads the entry chunk. */
const page = `<script>${syncChunksMarker}</script><script type="module" src="/assets/entry-a.js" async=""></script>`;

/** The cache name that a generated worker uses. */
const cacheNameOf = (source: string) => /const cacheName = '([^']+)'/u.exec(source)?.[1];

test('the built files are each file to serve, without build data and the worker itself', async () => {
  const files = await inRepo(
    {
      'index.html': '',
      'notes.html': '',
      'assets/entry-a.js': '',
      '.vite/manifest.json': '{}',
      'sw.js': '',
    },
    (dist) => builtFiles(dist).toSorted(),
  );
  expect(files).toEqual(['assets/entry-a.js', 'index.html', 'notes.html']);
});

test('the precache list holds each page and file of the build once, and `/` for the home page', () => {
  expect(precacheList(['index.html', 'notes.html', 'assets/entry-a.js'])).toEqual([
    '/',
    '/assets/entry-a.js',
    '/index.html',
    '/notes.html',
  ]);
  expect(precacheList(['assets/entry-a.js'])).toEqual(['/assets/entry-a.js']);
});

test('the sync chunks are the transport and its imports, without first-screen chunks', () => {
  expect(syncChunks(manifest, page)).toEqual(['/assets/effect-f.js', '/assets/transport-e.js']);
});

test('a new build gets a new cache name, and the worker caches the list it was given', () => {
  const one = serviceWorkerSource(['/', '/assets/a.js']);
  const two = serviceWorkerSource(['/', '/assets/b.js']);
  expect(cacheNameOf(one)).not.toBe(cacheNameOf(two));
  expect(one).toContain('const urls = ["/","/assets/a.js"]');
});

test('a navigation gets the page of its path, or the home page', () => {
  const urls = ['/', '/index.html', '/notes.html', '/team/index.html'];
  expect(serviceWorkerSource(urls)).toContain('pageFor(urls, url.pathname)');
  expect(
    ['/', '/notes', '/notes/', '/team', '/missing'].map((path) => pageFor(urls, path)),
  ).toEqual(['/index.html', '/notes.html', '/notes.html', '/team/index.html', '/index.html']);
});

test('the build writes the sync chunks into the boot script, and needs the marker', () => {
  const html = `<script>${syncChunksMarker}</script>`;
  expect(withSyncChunks(html, ['/assets/transport-e.js'])).toBe(
    '<script>const syncChunks = ["/assets/transport-e.js"];</script>',
  );
  expect(() => withSyncChunks('<script></script>', [])).toThrow('Restore it from the template');
});
