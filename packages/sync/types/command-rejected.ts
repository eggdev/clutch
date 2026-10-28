import { Schema } from 'effect';

/** A server change refused a transaction. The client rolls back its local change. */
export class CommandRejected extends Schema.TaggedError<CommandRejected>()('CommandRejected', {
  reason: Schema.String,
}) {}
