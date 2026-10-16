import { expect, test } from 'bun:test';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';

/**
 * Each test runs the worker with `wrangler dev`: workerd and a local R2
 * bucket in a new directory. See docs/principles/test-the-workflow.md, rung 1.
 * The wrangler test harness hangs under Bun, so the test talks to a real
 * `wrangler dev` process over HTTP.
 */
const app = path.join(import.meta.dir, '..');
const wrangler = path.join(app, '../../node_modules/.bin/wrangler');
const write = 'test-write-token';
const read = 'test-read-token';
const hash = '0123456789abcdef0123456789abcdef';

function freePort() {
  const server = Bun.serve({ port: 0, hostname: '127.0.0.1', fetch: () => new Response() });
  const { port } = server;
  server.stop(true);
  return port;
}

/** Starts the worker. `await using` stops it and deletes its R2 state. */
async function start(vars: Record<string, string>) {
  const state = await mkdtemp(path.join(tmpdir(), 'nx-cache-'));
  const port = freePort();
  const worker = Bun.spawn(
    [
      wrangler,
      'dev',
      '--config',
      path.join(app, 'wrangler.jsonc'),
      '--local',
      '--ip',
      '127.0.0.1',
      '--port',
      String(port),
      '--inspector-port',
      String(freePort()),
      '--persist-to',
      state,
      '--show-interactive-dev-session=false',
      ...Object.entries(vars).flatMap(([name, value]) => ['--var', `${name}:${value}`]),
    ],
    { env: { ...process.env, WRANGLER_SEND_METRICS: 'false' }, stdout: 'pipe', stderr: 'pipe' },
  );
  const url = `http://127.0.0.1:${port}`;
  const stop = async () => {
    worker.kill();
    await worker.exited;
    await rm(state, { recursive: true, force: true });
  };
  for (let attempt = 0; attempt < 120; attempt++) {
    const ready = await fetch(`${url}/health`).then(
      (response) => response.ok,
      () => false,
    );
    if (ready) {
      return { url, [Symbol.asyncDispose]: stop };
    }
    if (worker.exitCode !== null) {
      break;
    }
    await Bun.sleep(250);
  }
  await stop();
  throw new Error(`wrangler dev did not start:\n${await new Response(worker.stderr).text()}`);
}

function cache(server: { url: string }, token: string | null, init: RequestInit = {}, key = hash) {
  const headers = new Headers(init.headers);
  if (token) {
    headers.set('Authorization', `Bearer ${token}`);
  }
  return fetch(`${server.url}/v1/cache/${key}`, { ...init, headers });
}

async function status(response: Promise<Response>) {
  const { status: code } = await response;
  return code;
}

const artifact = (body: string | Uint8Array | ReadableStream) => ({
  method: 'PUT',
  body,
  headers: { 'Content-Type': 'application/octet-stream' },
});

test('health is public and names the commit; the cache refuses a missing or wrong token', async () => {
  await using server = await start({
    CACHE_WRITE_TOKEN: write,
    CACHE_READ_TOKEN: read,
    BUILD_COMMIT: 'abc123',
  });
  const health = await fetch(`${server.url}/health`);
  expect(health.status).toBe(200);
  expect(await health.json()).toEqual({ ok: true, commit: 'abc123' });

  expect(await status(cache(server, null))).toBe(401);
  expect(await status(cache(server, 'wrong-token'))).toBe(401);
  expect(await status(cache(server, write, {}, 'not-a-hash'))).toBe(404);
});

test('the writer stores an artifact once, and the reader reads it but cannot write', async () => {
  await using server = await start({ CACHE_WRITE_TOKEN: write, CACHE_READ_TOKEN: read });
  expect(await status(cache(server, read))).toBe(404);
  expect(await status(cache(server, write, artifact('first')))).toBe(200);
  expect(await status(cache(server, write, artifact('second')))).toBe(409);

  for (const token of [write, read]) {
    const response = await cache(server, token);
    expect(response.status).toBe(200);
    expect(response.headers.get('Content-Type')).toBe('application/octet-stream');
    expect(await response.text()).toBe('first');
  }

  const other = 'fedcba9876543210fedcba9876543210';
  const refused = await cache(server, read, artifact('poison'), other);
  expect(refused.status).toBe(403);
  expect(refused.headers.get('Content-Type')).toStartWith('text/plain');
  expect(await status(cache(server, write, {}, other))).toBe(404);
});

test('the writer cannot store an artifact with no length or over the size limit', async () => {
  await using server = await start({ CACHE_WRITE_TOKEN: write });
  const chunked = new ReadableStream({
    start(controller) {
      controller.enqueue(new TextEncoder().encode('no length'));
      controller.close();
    },
  });
  expect(await status(cache(server, write, artifact(chunked)))).toBe(400);

  const oversize = new Uint8Array(100 * 1024 * 1024 + 1);
  expect(await status(cache(server, write, artifact(oversize)))).toBe(413);
  expect(await status(cache(server, write))).toBe(404);
});

test('the cache stays closed when the tokens are missing or the same', async () => {
  const cases: Array<Record<string, string>> = [
    {},
    { CACHE_WRITE_TOKEN: write, CACHE_READ_TOKEN: write },
  ];
  for (const tokens of cases) {
    await using server = await start(tokens);
    expect(await status(cache(server, write))).toBe(503);
  }
});
