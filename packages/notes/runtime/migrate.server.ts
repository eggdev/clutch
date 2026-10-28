import type { DrizzleDatabase } from '@repo/sync/service/database';
import { migratePackage } from '@repo/sync/service/migrations';

/** Runs the migrations of the notes tables. */
export function migrateNotes(db: DrizzleDatabase) {
  return migratePackage(db, 'notes', new URL('../repo/migrations', import.meta.url));
}
