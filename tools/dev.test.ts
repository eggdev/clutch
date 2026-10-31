import { expect, test } from 'bun:test';
import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';

import { acquireLock, devApps, isUp, runRecordPath, stopRun } from '@tools/dev';
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

/** A process that sleeps until it is killed, standing in for a dev run or a server. */
const sleeper = () => Bun.spawn(['sleep', '30']);
const alive = (pid: number) => {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
};

/** Writes the run record that a dev run leaves while its servers run. */
function record(root: string, pid: number, children: Array<number>) {
  mkdirSync(path.dirname(runRecordPath(root)), { recursive: true });
  writeFileSync(runRecordPath(root), JSON.stringify({ pid, children }));
}

test('--stop stops the run and the servers that its record names, then removes the record', async () => {
  await inRepo({}, async (root) => {
    const runner = sleeper();
    const server = sleeper();
    record(root, runner.pid, [server.pid]);
    // The run stops its own servers on SIGTERM. Here the server is killed when the runner exits.
    void runner.exited.then(() => server.kill());
    const identify = (pid: number) =>
      ({ [runner.pid]: 'bun tools/dev.ts', [server.pid]: 'portless run --name web' })[pid] ?? '';
    const live = (pid: number) => (alive(pid) ? identify(pid) : '');
    expect(await stopRun(root, { timeoutMs: 5000, identify: live })).toBe(true);
    await Promise.all([runner.exited, server.exited]);
    expect([alive(runner.pid), alive(server.pid)]).toEqual([false, false]);
    expect(existsSync(runRecordPath(root))).toBe(false);
  });
});

test('--stop never signals a PID that another program reuses, and a checkout with no record stops nothing', async () => {
  await inRepo({}, async (root) => {
    expect(await stopRun(root)).toBe(false);
    const stranger = sleeper();
    record(root, stranger.pid, [stranger.pid]);
    expect(await stopRun(root, { identify: () => 'vim notes.md' })).toBe(false);
    expect(alive(stranger.pid)).toBe(true);
    expect(existsSync(runRecordPath(root))).toBe(false);
    stranger.kill();
    await stranger.exited;
  });
});

test('--stop kills a server that outlived a killed dev run', async () => {
  await inRepo({}, async (root) => {
    const server = sleeper();
    // PID 2 to the power 22 is above the macOS and Linux limits, so the run is gone.
    record(root, 2 ** 22, [server.pid]);
    const identify = (pid: number) => (pid === server.pid && alive(pid) ? 'portless run' : '');
    expect(await stopRun(root, { timeoutMs: 300, identify })).toBe(true);
    await server.exited;
    expect(alive(server.pid)).toBe(false);
  });
});
