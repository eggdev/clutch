import { expect, test } from 'bun:test';

import { PgClient } from '@effect/sql-pg';
import { Database } from '@repo/sync/service/database';
import { passingFailure } from '@repo/sync/service/settle';
import { describeOnPostgres } from '@repo/sync/testing/postgres';
import { raisedFailure } from '@repo/sync/testing/raised-failure';
import { sql } from 'drizzle-orm';
import * as PgDrizzle from 'drizzle-orm/effect-postgres';
import { Effect, Exit, Layer, Redacted } from 'effect';

/** Drizzle over the Postgres driver, with a pool of its own for one test. */
const postgres = (url: string) =>
  Layer.effect(Database)(PgDrizzle.makeWithDefaults()).pipe(
    Layer.provide(PgClient.layer({ url: Redacted.make(url) })),
  );

describeOnPostgres('the passing failures of the Postgres driver', (serverUrl) => {
  const failureOf = (code: string) =>
    Effect.runPromise(
      Effect.gen(function* () {
        return yield* raisedFailure(yield* Database, code);
      }).pipe(Effect.provide(postgres(serverUrl))),
    );

  for (const code of ['40001', '40P01', '55P03']) {
    test(`a failure with the code ${code} passes`, async () => {
      expect(passingFailure(await failureOf(code))).toBe(true);
    });
  }

  test('a failure with another code does not pass', async () => {
    expect(passingFailure(await failureOf('P0001'))).toBe(false);
  });

  test('a connection that the server ends in a transaction passes, also as a defect', async () => {
    const exit = await Effect.runPromise(
      Effect.gen(function* () {
        const db = yield* Database;
        return yield* db
          .transaction((tx) => tx.execute(sql`select pg_terminate_backend(pg_backend_pid())`))
          .pipe(Effect.exit);
      }).pipe(Effect.provide(postgres(serverUrl))),
    );
    // The rollback fails too, so the transaction ends as a defect of the driver.
    expect(Exit.isFailure(exit) && passingFailure(exit.cause)).toBe(true);
  });
});
