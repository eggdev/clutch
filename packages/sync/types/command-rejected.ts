import { Schema } from 'effect';

/**
 * A server change refused a transaction. The client rolls back its local
 * change. `code` is a refusal that the command declares in its contract, or a
 * built-in one, so code can branch on it. `reason` is the sentence for the
 * person. Make one with `refuse` from `commands/server-change.server.ts`.
 */
export class CommandRejected extends Schema.TaggedError<CommandRejected>()('CommandRejected', {
  code: Schema.String,
  reason: Schema.String,
}) {}
