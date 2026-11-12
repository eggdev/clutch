import { openIndexedDb } from '@repo/sync/runtime/indexed-db';
import type { LocalDatabase } from '@repo/sync/types/local-database';

/**
 * Opens the local database of the platform. The web keeps it in IndexedDB.
 * The native bundler picks `local-database.native.ts` in place of this file,
 * which keeps it in SQLite. An app calls this one function on each platform.
 */
export function openLocalDatabase(name: string): Promise<LocalDatabase> {
  return openIndexedDb(name);
}
