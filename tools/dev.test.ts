import { expect, test } from 'bun:test';
import { existsSync, writeFileSync } from 'node:fs';
import path from 'node:path';

import { acquireLock, devApps, isUp } from '@tools/dev';
import { inRepo } from '@tools/testing/in-repo';

const app = (dev: string | null, tags: Array<string> = []) =>
  JSON.stringify({
    nx: { tags, targets: dev ? { dev: { options: { command: dev } } } : {} },
  });

test('the apps with a dev target get portless names and a health path', async () => {
  const apps = await inRepo(
    {
      'package.json': JSON.stringify({ name: 'acme' }),
      'apps/web/package.json': app('vite'),
      'apps/api/package.json': app('bun --watch src/main.ts', ['platform:server']),
      'apps/cli/package.json': app(null),
    },
    devApps,
  );
  expect(apps.toSorted((a, b) => a.folder.localeCompare(b.folder))).toEqual([
    {
      folder: 'apps/api',
      name: 'api.acme',
      command: ['bun', '--watch', 'src/main.ts'],
      health: '/health',
    },
    { folder: 'apps/web', name: 'acme', command: ['vite'], health: '/' },
  ]);
});

test('a server counts as up only when it answers its health path for its host name', async () => {
  const server = Bun.serve({
    port: 0,
    fetch: (request) =>
      new URL(request.url).pathname === '/health' &&
      request.headers.get('host') === 'api.acme.localhost:1355'
        ? new Response('ok')
        : new Response('no route', { status: 404 }),
  });
  try {
    expect(await isUp(`http://api.acme.localhost:${server.port}`, '/health')).toBe(false);
    const proxyLike = Bun.serve({
      port: 0,
      fetch: (request) =>
        request.headers.get('host')?.startsWith('api.acme.localhost') &&
        new URL(request.url).pathname === '/health'
          ? new Response('ok')
          : new Response('{"error":"not_found"}', { status: 404 }),
    });
    try {
      const url = `http://api.acme.localhost:${proxyLike.port}`;
      expect(await isUp(url, '/health')).toBe(true);
      expect(await isUp(url, '/missing')).toBe(false);
      expect(await isUp('http://api.acme.localhost:1', '/health')).toBe(false);
    } finally {
      proxyLike.stop(true);
    }
  } finally {
    server.stop(true);
  }
});

test('a second run waits for the lock, and a lock from an ended process is taken over', async () => {
  await inRepo({}, async (root) => {
    const file = path.join(root, '.data/dev.lock');
    const release = await acquireLock(file);
    expect(existsSync(file)).toBe(true);
    await expect(acquireLock(file, 300)).rejects.toThrow('holds');
    release();
    expect(existsSync(file)).toBe(false);
    // PID 2 to the power 22 is above the macOS and Linux limits, so no process has it.
    writeFileSync(file, String(2 ** 22));
    const again = await acquireLock(file, 300);
    again();
  });
});
