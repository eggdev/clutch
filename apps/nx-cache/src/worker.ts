/**
 * The Nx self-hosted remote cache on R2. It serves the Nx HTTP cache spec:
 * `GET` and `PUT /v1/cache/{hash}` with a bearer token, and a public
 * `GET /health`. The write token reads and writes. The read token only reads.
 * The first PUT of a hash wins. See docs/contributing/setup/nx.md#remote-cache.
 */
type Env = {
  CACHE_BUCKET: R2Bucket;
  CACHE_WRITE_TOKEN?: string;
  CACHE_READ_TOKEN?: string;
  BUILD_COMMIT?: string;
};

type Access = 'read' | 'write';

const hashPattern = /^\/v1\/cache\/([a-fA-F0-9]{1,128})$/u;
const maxArtifactBytes = 100 * 1024 * 1024;
const encoder = new TextEncoder();

function text(status: number, message: string) {
  return new Response(message, {
    status,
    headers: { 'Content-Type': 'text/plain; charset=utf-8' },
  });
}

/** Compares SHA-256 digests, so the time does not depend on the token length or content. */
async function same(left: string, right: string) {
  const [a, b] = await Promise.all(
    [left, right].map((value) => crypto.subtle.digest('SHA-256', encoder.encode(value))),
  );
  return crypto.subtle.timingSafeEqual(a, b);
}

/** The access that the bearer token grants, or the response that refuses it. */
async function authorize(request: Request, env: Env): Promise<Access | Response> {
  const write = env.CACHE_WRITE_TOKEN?.trim() ?? '';
  const read = env.CACHE_READ_TOKEN?.trim() ?? '';
  if (!write) {
    return text(503, 'Nx cache is not configured: set the CACHE_WRITE_TOKEN secret');
  }
  if (read && (await same(write, read))) {
    return text(503, 'Nx cache tokens are misconfigured: the read token equals the write token');
  }
  const bearer = /^Bearer\s+(\S+)$/iu.exec(request.headers.get('Authorization')?.trim() ?? '');
  if (bearer && (await same(bearer[1], write))) {
    return 'write';
  }
  if (bearer && read && (await same(bearer[1], read))) {
    return 'read';
  }
  return text(401, 'Unauthorized');
}

async function get(env: Env, key: string) {
  const object = await env.CACHE_BUCKET.get(key);
  if (!object) {
    return text(404, 'The record was not found');
  }
  return new Response(object.body, {
    headers: {
      'Content-Type': 'application/octet-stream',
      'Content-Length': String(object.size),
    },
  });
}

async function put(request: Request, env: Env, key: string) {
  const header = request.headers.get('Content-Length');
  const length = Number(header);
  if (header === null || !request.body) {
    return text(400, 'Content-Length and a body are required');
  }
  if (!Number.isInteger(length) || length < 0) {
    return text(400, 'Content-Length is invalid');
  }
  if (length > maxArtifactBytes) {
    return text(413, 'The artifact is over the 100 MB limit');
  }
  // R2 refuses the write when any object has the key, so the first PUT wins.
  const stored = await env.CACHE_BUCKET.put(key, request.body, {
    onlyIf: { etagDoesNotMatch: '*' },
    httpMetadata: { contentType: 'application/octet-stream' },
  });
  if (!stored) {
    return text(409, 'Cannot override an existing record');
  }
  return new Response(null, { status: 200 });
}

async function handle(request: Request, env: Env): Promise<Response> {
  const { pathname } = new URL(request.url);
  if (pathname === '/health') {
    if (request.method !== 'GET' && request.method !== 'HEAD') {
      return text(405, 'Method not allowed');
    }
    return Response.json(
      { ok: true, commit: env.BUILD_COMMIT ?? null },
      { headers: { 'Cache-Control': 'no-store' } },
    );
  }
  const hash = hashPattern.exec(pathname)?.[1];
  if (!hash) {
    return text(404, 'Not found');
  }
  const access = await authorize(request, env);
  if (access instanceof Response) {
    return access;
  }
  const key = `v1/${hash}`;
  if (request.method === 'GET') {
    return get(env, key);
  }
  if (request.method !== 'PUT') {
    return text(405, 'Method not allowed');
  }
  if (access !== 'write') {
    return text(403, 'The read token cannot write');
  }
  return put(request, env, key);
}

export default { fetch: handle } satisfies ExportedHandler<Env>;
