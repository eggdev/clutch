import { RowNotStored } from '@repo/sync/types/row-not-stored';
import { Effect } from 'effect';

/**
 * The row that a write statement returned, which is the row that the database
 * holds. A repo ends a write with it, and never with its own input, so the
 * caller cannot mistake a row that was never stored for a stored one.
 */
export function storedRow(table: string) {
  return <A>(rows: ReadonlyArray<A>) => {
    const [row] = rows;
    return row === undefined
      ? Effect.fail(new RowNotStored({ table, reason: `The write to ${table} returned no row.` }))
      : Effect.succeed(row);
  };
}
