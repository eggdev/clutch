import type { DrizzleDatabase } from '@repo/sync/service/database';
import type { EffectPgDatabase } from 'drizzle-orm/effect-postgres';
import { migrate } from 'drizzle-orm/effect-postgres/migrator';

/**
 * Runs the migrations of one package. Each package keeps its own
 * `repo/migrations/` and its own migrations table.
 */
export function migratePackage(db: DrizzleDatabase, name: string, folder: URL) {
  // The migrator reads only `db.session`, which both drivers have. Its type
  // names the Postgres driver, so the shared type narrows to it here.
  return migrate(db as EffectPgDatabase, {
    migrationsFolder: decodeURIComponent(folder.pathname),
    migrationsTable: `__migrations_${name}`,
  });
}
