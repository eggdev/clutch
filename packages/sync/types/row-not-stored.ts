import { Schema } from 'effect';

/**
 * A write statement returned no row, so the database holds no row that the
 * caller can trust. `table` names the table, and `reason` is the sentence for
 * the operator. A server change that fails with it ends as `failed`, and a job
 * runs again.
 */
export class RowNotStored extends Schema.TaggedError<RowNotStored>()('RowNotStored', {
  table: Schema.String,
  reason: Schema.String,
}) {}
