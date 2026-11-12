import { Platform, Settings } from 'react-native';

/**
 * The origin of the API. A native app has no page origin, so its bundle
 * carries one: vite.config.ts fills `EXPO_PUBLIC_API_ORIGIN` with the API of
 * development, and a release build names its own.
 */
const origin = process.env.EXPO_PUBLIC_API_ORIGIN ?? 'http://localhost:4000';

/** Where the sync socket is: `/sync` on the API, as `ws` for `http` and `wss` for `https`. */
export function syncUrl(): string {
  return `${origin.replace(/^http/u, 'ws').replace(/\/$/u, '')}/sync`;
}

/**
 * The headers of the sync socket. A journey starts the app with the launch
 * argument `devOrganization`, and the development identity of the API reads
 * it from this header, so each run has an organization of its own. iOS puts a
 * launch argument in the defaults that `Settings` reads. Android has no such
 * read, so an Android run shares the organization of development.
 */
export function socketHeaders(): Readonly<Record<string, string>> | undefined {
  const organization: unknown = Platform.OS === 'ios' ? Settings.get('devOrganization') : undefined;
  return typeof organization === 'string' && organization
    ? { 'x-dev-organization-id': organization }
    : undefined;
}

/** After a session ends, the app stays open and reads its empty local database again. */
export function afterSessionEnded(): void {
  // Nothing to load again: the boot module starts over.
}
