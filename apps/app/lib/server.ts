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

/**
 * After a session ends, or a newer build takes the local database, the page
 * loads again from its start. It does not call `restart` first: a start in
 * the old page would open the old build on a database that may be newer.
 */
export function afterSessionEnded(_restart: () => void): void {
  location.assign('/');
}
