import type { EffectPgQueryEffectHKT } from 'drizzle-orm/effect-postgres/session';
import type { PgQueryResultHKT } from 'drizzle-orm/pg-core';
import type { PgEffectDatabase } from 'drizzle-orm/pg-core/effect';
import { Context } from 'effect';

/**
 * The authority database, as Drizzle sees it. The PGlite driver (local
 * development and tests) and the Postgres driver (production) both give this
 * type, so each repo is written once. A transaction has the same type.
 */
export type DrizzleDatabase = PgEffectDatabase<EffectPgQueryEffectHKT, PgQueryResultHKT>;

/** The authority database. The composition root of the server app selects the driver. */
export class Database extends Context.Service<Database, DrizzleDatabase>()('sync/Database') {}
