/**
 * Where the sync socket is, on the web: the origin of the page. The dev server
 * and a deployed host route `/sync` to the API. The native bundler picks
 * `server.native.ts` in place of this file.
 */
export function syncUrl(): string {
  const url = new URL('/sync', location.href);
  url.protocol = url.protocol === 'https:' ? 'wss:' : 'ws:';
  return url.href;
}

/** A browser sends its cookies, and can set no header on a socket. */
export function socketHeaders(): Readonly<Record<string, string>> | undefined {
  return undefined;
}

/** After a session ends, the page loads again from its start, with an empty local database. */
export function afterSessionEnded(): void {
  location.assign('/');
}
