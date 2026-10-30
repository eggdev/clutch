import { PgliteClient } from '@effect/sql-pglite';
import { migrateSync } from '@repo/sync/runtime/migrate.server';
import { Database } from '@repo/sync/service/database';
import type { DrizzleDatabase } from '@repo/sync/service/database';
import * as PgliteDrizzle from 'drizzle-orm/effect-pglite';
import { Effect, Layer } from 'effect';

type Migration = (db: DrizzleDatabase) => Effect.Effect<unknown, unknown>;

/** `Database` over one PGlite instance, with the client too, so a caller can dump it. */
const pglite = (options: { loadDataDir?: Blob }) =>
  Layer.effect(Database)(PgliteDrizzle.makeWithDefaults()).pipe(
    Layer.provideMerge(PgliteClient.layer(options)),
  );

/** Migrates a new database with `migrations`, and dumps its data directory. */
const migrateAndDump = (migrations: ReadonlyArray<Migration>) =>
  Effect.gen(function* () {
    const db = yield* Database;
    yield* migrateSync(db);
    for (const run of migrations) {
      yield* run(db);
    }
    const client = yield* PgliteClient.PgliteClient;
    return yield* Effect.promise(() => client.pglite.dumpDataDir('none'));
  }).pipe(Effect.orDie, Effect.provide(pglite({})));

/**
 * One migrated dump for each list of migrations. Migrating takes about 0.7 s,
 * so each process migrates once, and each test loads the dump into its own
 * instance. Two tests that start at once may both migrate. Either dump works.
 */
const templates: Array<{ migrations: ReadonlyArray<Migration>; dump: Blob }> = [];

const template = (migrations: ReadonlyArray<Migration>) =>
  Effect.gen(function* () {
    const found = templates.find(
      (entry) =>
        entry.migrations.length === migrations.length &&
        entry.migrations.every((run, index) => run === migrations[index]),
    );
    if (found) {
      return found.dump;
    }
    const dump = yield* migrateAndDump(migrations);
    templates.push({ migrations, dump });
    return dump;
  });

/**
 * A fresh in-memory Postgres for one test, with the event log and each
 * package migration from `migrations` applied. It is the real database
 * engine, not a fake. Each test gets its own instance, loaded from a dump that
 * the process migrated once.
 */
export function DatabaseTest(...migrations: ReadonlyArray<Migration>) {
  return Layer.unwrap(Effect.map(template(migrations), (loadDataDir) => pglite({ loadDataDir })));
}
