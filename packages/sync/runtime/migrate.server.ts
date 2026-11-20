import { fillRecords } from '@repo/sync/repo/events';
import type { DrizzleDatabase } from '@repo/sync/service/database';
import { migratePackage } from '@repo/sync/service/migrations';
import { Effect } from 'effect';

/**
 * Runs the migrations of the event log. A log from before the record state
 * then gets the state of each record from its events, once.
 */
export function migrateSync(db: DrizzleDatabase) {
  return migratePackage(db, 'sync', new URL('../repo/migrations', import.meta.url)).pipe(
    Effect.andThen(fillRecords(db)),
  );
}
