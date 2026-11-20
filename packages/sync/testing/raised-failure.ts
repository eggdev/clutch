import type { DrizzleDatabase } from '@repo/sync/service/database';
import { sql } from 'drizzle-orm';
import { Effect } from 'effect';

/**
 * The failure of a database transaction whose statement raises an error with
 * the Postgres `code`, as the driver of `db` gives it. Each driver carries the
 * code in its own way, so a test of the passing failures runs on each one.
 */
export function raisedFailure(db: DrizzleDatabase, code: string) {
  return db
    .transaction((tx) =>
      tx.execute(
        sql.raw(`do $$ begin raise exception 'A test failure' using errcode = '${code}'; end $$`),
      ),
    )
    .pipe(Effect.flip);
}
