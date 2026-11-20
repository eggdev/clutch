import type { DrizzleDatabase } from '@repo/sync/service/database';
import { sql } from 'drizzle-orm';
import { readMigrationFiles } from 'drizzle-orm/migrator';
import { migrate } from 'drizzle-orm/pg-core/effect';
import { Effect } from 'effect';

/**
 * The key of the Postgres advisory lock that each migration run takes. Each
 * package uses the one key, because all of them create the schema of the
 * migrations tables.
 */
const migrationLock = 'repo migrations';

/**
 * Runs the migrations of one package. Each package keeps its own
 * `repo/migrations/` and its own migrations table. The Postgres and PGlite
 * drivers share one session type, so the migrator of `pg-core/effect` takes
 * the session of either one. The run is one transaction that first takes an
 * advisory lock. So when two server processes start at once, the second waits
 * for the first, then finds each migration applied. Without the lock, both
 * read the applied migrations before either commits, and both apply them.
 */
export function migratePackage(db: DrizzleDatabase, name: string, folder: URL) {
  const config = {
    migrationsFolder: decodeURIComponent(folder.pathname),
    migrationsTable: `__migrations_${name}`,
  };
  return db.transaction((tx) =>
    tx
      .execute(sql`select pg_advisory_xact_lock(hashtext(${migrationLock}))`)
      .pipe(Effect.andThen(migrate(readMigrationFiles(config), tx._.session, config))),
  );
}
