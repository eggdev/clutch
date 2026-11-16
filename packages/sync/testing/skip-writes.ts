import type { DrizzleDatabase } from '@repo/sync/service/database';
import { sql } from 'drizzle-orm';
import { Effect } from 'effect';

/**
 * Makes the database skip each insert into `table`, with a trigger that
 * returns no row. The statement succeeds and returns no row, so a test can
 * prove that a repo fails instead of returning its input.
 */
export function skipWrites(db: DrizzleDatabase, table: string) {
  return Effect.gen(function* () {
    yield* db.execute(
      sql`create or replace function skip_row() returns trigger language plpgsql as $$ begin return null; end $$`,
    );
    yield* db.execute(
      sql.raw(
        `create trigger skip_${table} before insert on ${table} for each row execute function skip_row()`,
      ),
    );
  });
}
