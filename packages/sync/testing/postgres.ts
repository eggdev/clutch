import { describe } from 'bun:test';

import { PgClient } from '@effect/sql-pg';
import type { DrizzleDatabase } from '@repo/sync/service/database';
import { sql } from 'drizzle-orm';
import type { SQL } from 'drizzle-orm';
import { Effect, Redacted, Schema } from 'effect';

/**
 * The tests of the sync engine on a real Postgres server read the server from
 * this variable, and never from `DATABASE_URL`, so a test cannot touch a
 * developer's database or a deployed one. See docs/contributing/testing.md.
 */
const urlVariable = 'SYNC_TEST_DATABASE_URL';

/** When set to `1`, a missing server fails the tests instead of skipping them. CI sets it. */
const requiredVariable = 'SYNC_TEST_POSTGRES_REQUIRED';

const serverUrl = process.env[urlVariable] ?? '';

/**
 * Runs the tests of `body` on the real Postgres server that
 * `SYNC_TEST_DATABASE_URL` names, with its URL. With no server named, it
 * skips them and prints one line that says why, so `bun test` on a laptop
 * stays fast. When `SYNC_TEST_POSTGRES_REQUIRED` is `1`, a missing server
 * fails the file instead, so CI cannot pass with the tests skipped.
 */
export function describeOnPostgres(name: string, body: (url: string) => void) {
  if (serverUrl !== '') {
    describe(name, () => body(serverUrl));
    return;
  }
  if (process.env[requiredVariable] === '1') {
    throw new Error(
      `${requiredVariable} is 1, but ${urlVariable} is not set, so "${name}" cannot run on a real Postgres server.`,
    );
  }
  process.stdout.write(
    `Skipped "${name}": set ${urlVariable} to run it on a real Postgres server.\n`,
  );
  describe.skip(name, () => body(serverUrl));
}

/** The rows of a raw query, decoded with `row`, so a test reads them with no cast. */
export function rowsOf<S extends Schema.ConstraintDecoder<unknown>>(
  db: DrizzleDatabase,
  row: S,
  query: SQL,
) {
  const decode = Schema.decodeUnknownEffect(Schema.Struct({ rows: Schema.Array(row) }));
  return db.execute(query).pipe(
    Effect.flatMap(decode),
    Effect.map((result) => result.rows),
  );
}

/** The backends of `process`, an application name, that hold `LISTEN` on the database of `db`. */
export function listeners(db: DrizzleDatabase, process: string) {
  return rowsOf(
    db,
    Schema.Struct({ pid: Schema.Number }),
    sql`select pid from pg_stat_activity
      where datname = current_database() and application_name = ${process}
        and query ilike 'listen%'`,
  ).pipe(Effect.map((rows) => rows.map((row) => row.pid)));
}

/** Runs `step` every 10 ms until `done` holds for its result. The test's time limit bounds it. */
export function repeatUntil<A, E>(step: Effect.Effect<A, E>, done: (result: A) => boolean) {
  return step.pipe(Effect.tap(Effect.sleep('10 millis')), Effect.repeat({ until: done }));
}

/**
 * Waits until the wake of `process` holds `LISTEN`, and gives its backend.
 * The wake listens on its own fiber, so a signal sent before then is lost.
 */
export function listening(db: DrizzleDatabase, process: string) {
  return repeatUntil(listeners(db, process), (pids) => pids.length > 0).pipe(
    Effect.map((pids) => pids[0] ?? 0),
  );
}

/** Runs one statement on the database of `url`, with a connection of its own. */
function runOn(url: string, statement: string) {
  return Effect.gen(function* () {
    const client = yield* PgClient.PgClient;
    yield* client.unsafe(statement);
  }).pipe(Effect.provide(PgClient.layer({ url: Redacted.make(url), maxConnections: 1 })));
}

/**
 * A new empty database on the server of `url` for one test, dropped with
 * each connection to it when the scope closes. It gives the URL of the new
 * database, with `name` as the application name of each connection, so a
 * test can find the connections of one process in `pg_stat_activity`. Two
 * runs at once each get their own database, so they cannot meet.
 */
export function freshDatabase(url: string) {
  return Effect.acquireRelease(
    Effect.gen(function* () {
      const name = `sync_test_${crypto.randomUUID().replaceAll('-', '')}`;
      yield* runOn(url, `create database ${name}`);
      return name;
    }),
    (name) => runOn(url, `drop database if exists ${name} with (force)`).pipe(Effect.orDie),
  ).pipe(
    Effect.map((name) => (process: string) => {
      const target = new URL(url);
      target.pathname = `/${name}`;
      target.searchParams.set('application_name', process);
      return target.toString();
    }),
  );
}
