import { PgClient } from '@effect/sql-pg';
import { PgliteClient } from '@effect/sql-pglite';
import { WakePglite, WakePostgres } from '@repo/sync/runtime/wake.server';
import { Database } from '@repo/sync/service/database';
import * as PgliteDrizzle from 'drizzle-orm/effect-pglite';
import * as PgDrizzle from 'drizzle-orm/effect-postgres';
import { Layer, Redacted } from 'effect';

/**
 * The two drivers of the authority database. Both give the same `Database`
 * service, so no repo knows which one runs, and a `Wake` over the same
 * client. The composition root of the server app selects one.
 */

/**
 * Postgres in the process, for local development and tests. No server to
 * install. Its wake reaches only this process, so a PGlite server runs as one
 * process.
 */
export function DatabasePglite(dataDir?: string) {
  return Layer.merge(Layer.effect(Database)(PgliteDrizzle.makeWithDefaults()), WakePglite).pipe(
    Layer.provide(PgliteClient.layer(dataDir ? { dataDir } : {})),
  );
}

/** A Postgres server, for production. Its wake reaches each process of the server. */
export function DatabasePostgres(url: string) {
  return Layer.merge(Layer.effect(Database)(PgDrizzle.makeWithDefaults()), WakePostgres).pipe(
    Layer.provide(PgClient.layer({ url: Redacted.make(url) })),
  );
}
