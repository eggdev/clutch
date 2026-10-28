import { migrateAccess } from '@repo/access/runtime/migrate.server';
import { AccessLive } from '@repo/access/service/access';
import type { DrizzleDatabase } from '@repo/sync/service/database';
import { DatabaseTest } from '@repo/sync/testing/database';
import { Layer } from 'effect';

/** The access tables, for the test database of a package that runs access checks. */
export function accessTables(db: DrizzleDatabase) {
  return migrateAccess(db);
}

/** The `Access` service over a fresh in-memory database with the access tables. */
export const AccessTest = () => Layer.provideMerge(AccessLive, DatabaseTest(migrateAccess));
