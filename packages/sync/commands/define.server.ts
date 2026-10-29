import type { Actor } from '@repo/identity/types/actor';
import type { DrizzleDatabase } from '@repo/sync/service/database';
import { SyncGroups } from '@repo/sync/service/sync-groups';
import type { TransactionService } from '@repo/sync/service/transaction-safe';
import { CommandRejected } from '@repo/sync/types/command-rejected';
import type { Change } from '@repo/sync/types/protocol';
import type { Command } from '@repo/sync/types/records';
import { Effect, Schema } from 'effect';

/** What a server change receives: the transaction to write in, and the actor. */
export type ServerContext = { readonly db: DrizzleDatabase; readonly actor: Actor };

/**
 * Who may run a server change. `'organization'` lets any actor of the
 * organization run it. `group` names the sync group of the record that the
 * change writes. The actor must be allowed that group. `null` means the
 * record does not exist.
 */
export type AccessRule<Input> =
  | 'organization'
  | {
      readonly group: (
        input: Input,
        context: ServerContext,
      ) => Effect.Effect<string | null, unknown>;
    };

/** The server half of one command, as the sync server runs it. `R` lists its services. */
export type ServerChange<R = never> = {
  readonly name: string;
  readonly run: (
    input: unknown,
    context: ServerContext,
  ) => Effect.Effect<ReadonlyArray<Change>, unknown, R>;
};

/**
 * Checks the access rule before the change runs. This is the one door for
 * write access: a server change never checks access by hand.
 */
function checkAccess<Input>(rule: AccessRule<Input>, input: Input, context: ServerContext) {
  return Effect.gen(function* () {
    if (rule === 'organization') {
      return;
    }
    const group = yield* rule.group(input, context);
    if (group === null) {
      return yield* new CommandRejected({ reason: 'This record does not exist.' });
    }
    const groups = yield* SyncGroups;
    if (!(yield* groups.canUse(context.db, context.actor, group))) {
      return yield* new CommandRejected({ reason: 'You may not change records here.' });
    }
  });
}

/**
 * Defines the server half of a command. It decodes the input with the
 * command's schema, checks the access rule, then writes the owner records in
 * the transaction and returns each record it changed. A failure with
 * `CommandRejected` rolls the transaction back and tells the client why.
 *
 * `run` may use only transaction-safe services (see `transaction-safe.ts`).
 * A vendor call goes in a job, which runs after the commit.
 */
export function defineServerChange<Input, Encoded, R extends TransactionService = never>(
  command: Command<Input>,
  definition: {
    readonly input: Schema.Codec<Input, Encoded>;
    readonly access: AccessRule<Input>;
    readonly run: (
      input: Input,
      context: ServerContext,
    ) => Effect.Effect<ReadonlyArray<Change>, unknown, R>;
  },
): ServerChange<R | SyncGroups> {
  const decode = Schema.decodeUnknownEffect(definition.input);
  return {
    name: command.name,
    run: (raw, context) =>
      decode(raw).pipe(
        Effect.mapError(
          () => new CommandRejected({ reason: `The input of ${command.name} is not valid.` }),
        ),
        Effect.tap((value) => checkAccess(definition.access, value, context)),
        Effect.flatMap((value) => definition.run(value, context)),
      ),
  };
}
