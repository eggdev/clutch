import { expect, test } from 'bun:test';

import { Database } from '@repo/sync/service/database';
import { passingFailure } from '@repo/sync/service/settle';
import { DatabaseTest } from '@repo/sync/testing/database';
import { raisedFailure } from '@repo/sync/testing/raised-failure';
import { Effect } from 'effect';

/**
 * A passing failure of the database, through the PGlite driver: the server
 * change meets it in a database transaction, and Drizzle wraps the error of
 * the driver. `settle.postgres.test.ts` holds the same for the Postgres driver.
 */
const failureOf = (code: string) =>
  Effect.runPromise(
    Effect.gen(function* () {
      return yield* raisedFailure(yield* Database, code);
    }).pipe(Effect.provide(DatabaseTest())),
  );

for (const code of ['40001', '40P01', '55P03']) {
  test(`PGlite: a failure with the code ${code} passes`, async () => {
    expect(passingFailure(await failureOf(code))).toBe(true);
  });
}

test('PGlite: a failure with another code does not pass', async () => {
  expect(passingFailure(await failureOf('P0001'))).toBe(false);
});
