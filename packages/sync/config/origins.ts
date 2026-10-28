import { Config, Option } from 'effect';

/**
 * The origins that may open the sync socket. Set `SYNC_ORIGINS` to a list of
 * exact origins, separated by commas, in every deployed environment. When it
 * is not set, the server is in local development, and it accepts loopback
 * origins only.
 */
export const syncOrigins = Config.option(Config.String('SYNC_ORIGINS')).pipe(
  Config.map((value) =>
    value.pipe(
      Option.map((list) =>
        list
          .split(',')
          .map((origin) => origin.trim())
          .filter((origin) => origin.length > 0),
      ),
    ),
  ),
);

const loopbackHosts = new Set(['localhost', '127.0.0.1', '[::1]']);

/**
 * Whether a socket request from `origin` may open. A browser always sends
 * `Origin` on a WebSocket request, so a request with no origin is not a
 * cross-site socket from a page, and it passes.
 */
export function originAllowed(
  origin: string | undefined,
  allowed: Option.Option<ReadonlyArray<string>>,
): boolean {
  if (origin === undefined) {
    return true;
  }
  if (Option.isSome(allowed)) {
    return allowed.value.includes(origin);
  }
  if (!URL.canParse(origin)) {
    return false;
  }
  const { hostname } = new URL(origin);
  return loopbackHosts.has(hostname) || hostname.endsWith('.localhost');
}
