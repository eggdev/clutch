import type { Actor } from '@repo/identity/types/actor';
import { builtInRefusals } from '@repo/sync/contract/command';
import type {
  Access,
  BuiltInRefusal,
  CommandDeclaration,
  Waits,
} from '@repo/sync/contract/command';
import { organizationGroup } from '@repo/sync/contract/engine-groups';
import { matches } from '@repo/sync/contract/fields';
import type { Fields, TypeOf } from '@repo/sync/contract/fields';
import type { DrizzleDatabase } from '@repo/sync/service/database';
import { SyncGroups } from '@repo/sync/service/sync-groups';
import type { TransactionService } from '@repo/sync/service/transaction-safe';
import { CommandRejected } from '@repo/sync/types/command-rejected';
import type { Change } from '@repo/sync/types/protocol';
import { UndeclaredRefusal } from '@repo/sync/types/undeclared-refusal';
import { Effect } from 'effect';

/** What a server change receives: the transaction to write in, and the actor. */
type ServerContext = { readonly db: DrizzleDatabase; readonly actor: Actor };

/**
 * Refuses the transaction with a code. The code is one that the command
 * declares in `refuses`, or a built-in one, so a wrong code does not compile.
 * The sync server rolls the transaction back and gives the client the code
 * and the reason.
 */
type Refuse<Refusal extends string = string> = (
  code: Refusal | BuiltInRefusal,
  reason: string,
) => CommandRejected;

/** What the `run` of a command receives: the server context, and `refuse` for the codes of this command. */
export type RunContext<Refusal extends string = string> = ServerContext & {
  readonly refuse: Refuse<Refusal>;
};

/** The server half of one command, as the sync server runs it. `R` lists its services. */
export type ServerChange<R = never, Name extends string = string> = {
  readonly name: Name;
  readonly run: (
    input: unknown,
    context: ServerContext,
  ) => Effect.Effect<ReadonlyArray<Change>, unknown, R>;
};

/** The services that a list of server changes needs. The server app provides each one. */
export type ServicesOf<Changes extends ReadonlyArray<ServerChange<unknown>>> =
  Changes[number] extends ServerChange<infer R> ? R : never;

/**
 * The sync group of the record that a change writes. The actor must be
 * allowed that group. `null` means the record does not exist.
 */
type GroupOf<Input> = (
  input: Input,
  context: ServerContext,
) => Effect.Effect<string | null, unknown>;

/**
 * The `refuse` that a run receives. Its type is narrowed to the codes of one
 * command by `RunContext`, so a server half cannot name another command's code.
 */
const refuseWith: Refuse = (code, reason) => new CommandRejected({ code, reason });

/**
 * Checks the access rule before the change runs. This is the one door for
 * write access: a server change never checks access by hand. A command with
 * `access: 'group'` needs the group of its record. A command that declares a
 * `permission` also needs the actor's role to grant it, on that group or on
 * the organization. It gives the group that the actor may write in, when the
 * command has `access: 'group'`, and `undefined` otherwise.
 */
function checkAccess<Input>(
  rule: { readonly group: GroupOf<Input> | undefined; readonly permission: string | undefined },
  input: Input,
  context: ServerContext,
) {
  return Effect.gen(function* () {
    if (!rule.group && rule.permission === undefined) {
      return;
    }
    const named = rule.group
      ? yield* rule.group(input, context)
      : organizationGroup.of(context.actor.organizationId);
    if (named === null) {
      return yield* new CommandRejected({
        code: 'not-found',
        reason: 'This record does not exist.',
      });
    }
    const groups = yield* SyncGroups;
    if (rule.group && !(yield* groups.canUse(context.db, context.actor, named))) {
      return yield* new CommandRejected({
        code: 'forbidden',
        reason: 'You may not change records here.',
      });
    }
    if (rule.permission !== undefined) {
      const allowed = groups.allows
        ? yield* groups.allows(context.db, context.actor, named, rule.permission)
        : false;
      if (!allowed) {
        return yield* new CommandRejected({
          code: 'forbidden',
          reason: `You need the ${rule.permission} permission.`,
        });
      }
    }
    return rule.group ? named : undefined;
  });
}

/**
 * Checks that each change of a `access: 'group'` command is in the group that
 * the command checked. A change of another group is a broken rule of the
 * server, so it is a defect, and the transaction does not commit.
 */
function checkWithin(command: string, authorized: string, changes: ReadonlyArray<Change>) {
  const stray = changes.find((change) => !change.groups.includes(authorized));
  return stray
    ? Effect.die(
        new Error(
          `The command ${command} checked the group "${authorized}", but its change of ${stray.model} ${stray.id} is in the groups ${stray.groups.join(', ')}. A command with \`access: 'group'\` writes only records of the group it checked. Write the record in the checked group, or check the group of the record.`,
        ),
      )
    : Effect.void;
}

/**
 * Defines the server half of a command. It checks the input against the
 * fields of the command, checks the access rule, then writes the owner
 * records in the transaction and returns each record it changed. A command
 * with `access: 'group'` gives `group`, and one without it does not compile.
 * `run` gets `refuse` for the codes that this command declares. A refusal
 * rolls the transaction back and tells the client why.
 *
 * A command with `access: 'group'` writes only records of the group that
 * `group` names: each change it returns must name that group among its
 * groups, or the change is a defect and nothing commits. A command with
 * `access: 'organization'` gets no such check, because a record of the
 * organization may sit in a smaller group of it.
 *
 * `run` may use only transaction-safe services (see `transaction-safe.ts`).
 * A vendor call goes in a job, which runs after the commit.
 */
export function serverChange<
  const Name extends string,
  const F extends Fields,
  const A extends Access,
  const Refusal extends string,
  R extends TransactionService = never,
>(
  declared: CommandDeclaration<Name, F, Waits, A, Refusal>,
  definition: {
    readonly run: (
      input: TypeOf<F>,
      context: RunContext<Refusal>,
    ) => Effect.Effect<ReadonlyArray<Change>, unknown, R>;
  } & (A extends 'group' ? { readonly group: GroupOf<TypeOf<F>> } : { readonly group?: never }),
): ServerChange<R | SyncGroups, Name> {
  const declaredCodes = new Set<string>([...builtInRefusals, ...declared.refuses]);
  return {
    name: declared.name,
    run: (raw, context) =>
      Effect.gen(function* () {
        if (!matches(declared.input, raw)) {
          return yield* new CommandRejected({
            code: 'invalid-input',
            reason: `The input of ${declared.name} is not valid.`,
          });
        }
        const authorized = yield* checkAccess(
          { group: definition.group, permission: declared.permission },
          raw,
          context,
        );
        const changes = yield* definition.run(raw, { ...context, refuse: refuseWith }).pipe(
          Effect.mapError((failure) =>
            failure instanceof CommandRejected && !declaredCodes.has(failure.code)
              ? new UndeclaredRefusal({
                  command: declared.name,
                  code: failure.code,
                  message: `The command ${declared.name} refused with the code "${failure.code}", which its contract does not declare. Add the code to \`refuses\`, or use \`refuse\` from the run context with a declared one.`,
                })
              : failure,
          ),
        );
        if (authorized !== undefined) {
          yield* checkWithin(declared.name, authorized, changes);
        }
        return changes;
      }),
  };
}
