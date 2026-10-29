import type { DrizzleDatabase } from '@repo/sync/service/database';
import { readMigrationFiles } from 'drizzle-orm/migrator';
import { migrate } from 'drizzle-orm/pg-core/effect';

/**
 * Runs the migrations of one package. Each package keeps its own
 * `repo/migrations/` and its own migrations table. The Postgres and PGlite
 * drivers share one session type, so the migrator of `pg-core/effect` takes
 * the session of either one.
 */
export function migratePackage(db: DrizzleDatabase, name: string, folder: URL) {
  const config = {
    migrationsFolder: decodeURIComponent(folder.pathname),
    migrationsTable: `__migrations_${name}`,
  };
  return migrate(readMigrationFiles(config), db._.session, config);
}
