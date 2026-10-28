import type { Actor } from '@repo/identity/types/actor';
import type { DrizzleDatabase } from '@repo/sync/service/database';
import { CommandRejected } from '@repo/sync/types/command-rejected';
import type { Change } from '@repo/sync/types/protocol';
import type { Command } from '@repo/sync/types/records';
import { Effect, Schema } from 'effect';

/** What a server change receives: the transaction to write in, and the actor. */
export type ServerContext = { readonly db: DrizzleDatabase; readonly actor: Actor };

/** The server half of one command, as the sync server runs it. */
export type ServerChange = {
  readonly name: string;
  readonly run: (
    input: unknown,
    context: ServerContext,
  ) => Effect.Effect<ReadonlyArray<Change>, unknown>;
};

/**
 * Defines the server half of a command. It decodes the input with the
 * command's schema, writes the owner records in the transaction, checks
 * access, and returns each record it changed. A failure with
 * `CommandRejected` rolls the transaction back and tells the client why.
 */
export function defineServerChange<Input, Encoded>(
  command: Command<Input>,
  input: Schema.Codec<Input, Encoded>,
  run: (input: Input, context: ServerContext) => Effect.Effect<ReadonlyArray<Change>, unknown>,
): ServerChange {
  const decode = Schema.decodeUnknownEffect(input);
  return {
    name: command.name,
    run: (raw, context) =>
      decode(raw).pipe(
        Effect.mapError(
          () => new CommandRejected({ reason: `The input of ${command.name} is not valid.` }),
        ),
        Effect.flatMap((value) => run(value, context)),
      ),
  };
}
