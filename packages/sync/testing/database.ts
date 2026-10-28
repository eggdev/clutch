import { DatabasePglite } from '@repo/sync/runtime/database.server';
import { migrateSync } from '@repo/sync/runtime/migrate.server';
import { Database } from '@repo/sync/service/database';
import type { DrizzleDatabase } from '@repo/sync/service/database';
import { Effect, Layer } from 'effect';

/**
 * A fresh in-memory Postgres for one test, with the event log and each
 * package migration from `migrations` applied. It is the real database
 * engine, not a fake.
 */
export function DatabaseTest(
  ...migrations: ReadonlyArray<(db: DrizzleDatabase) => Effect.Effect<unknown, unknown>>
) {
  const migrated = Layer.effectDiscard(
    Effect.gen(function* () {
      const db = yield* Database;
      yield* migrateSync(db);
      for (const run of migrations) {
        yield* run(db);
      }
    }).pipe(Effect.orDie),
  );
  return Layer.provideMerge(migrated, DatabasePglite());
}
