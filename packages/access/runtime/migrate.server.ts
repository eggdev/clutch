import type { DrizzleDatabase } from '@repo/sync/service/database';
import { migratePackage } from '@repo/sync/service/migrations';

/** Runs the migrations of the access tables. drizzle-kit writes them. */
export function migrateAccess(db: DrizzleDatabase) {
  return migratePackage(db, 'access', new URL('../repo/migrations', import.meta.url));
}
