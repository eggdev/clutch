import { Schema } from 'effect';

/**
 * A server change refused a transaction with a code that its command does not
 * declare. The contract is wrong, not the caller: the server logs this and
 * answers `failed`. The message names the fix.
 */
export class UndeclaredRefusal extends Schema.TaggedError<UndeclaredRefusal>()(
  'UndeclaredRefusal',
  {
    command: Schema.String,
    code: Schema.String,
    message: Schema.String,
  },
) {}
