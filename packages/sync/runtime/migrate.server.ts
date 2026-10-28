import type { DrizzleDatabase } from '@repo/sync/service/database';
import { migratePackage } from '@repo/sync/service/migrations';

/** Runs the migrations of the event log. */
export function migrateSync(db: DrizzleDatabase) {
  return migratePackage(db, 'sync', new URL('../repo/migrations', import.meta.url));
}
