import { PgClient } from '@effect/sql-pg';
import { PgliteClient } from '@effect/sql-pglite';
import { Database } from '@repo/sync/service/database';
import * as PgliteDrizzle from 'drizzle-orm/effect-pglite';
import * as PgDrizzle from 'drizzle-orm/effect-postgres';
import { Layer, Redacted } from 'effect';

/**
 * The two drivers of the authority database. Both give the same `Database`
 * service, so no repo knows which one runs. The composition root of the
 * server app selects one.
 */

/** Postgres in the process, for local development and tests. No server to install. */
export function DatabasePglite(dataDir?: string) {
  return Layer.effect(Database)(PgliteDrizzle.makeWithDefaults()).pipe(
    Layer.provide(PgliteClient.layer(dataDir ? { dataDir } : {})),
  );
}

/** A Postgres server, for production. */
export function DatabasePostgres(url: string) {
  return Layer.effect(Database)(PgDrizzle.makeWithDefaults()).pipe(
    Layer.provide(PgClient.layer({ url: Redacted.make(url) })),
  );
}
