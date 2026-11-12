import type { Actor } from '@repo/identity/types/actor';
import type { ServerChange } from '@repo/sync/commands/server-change.server';
import type { BuiltInRefusal } from '@repo/sync/contract/command';
import { EventLog } from '@repo/sync/service/event-log';
import { CommandRejected } from '@repo/sync/types/command-rejected';
import type { Outcome, Transaction } from '@repo/sync/types/protocol';
import { ServerUnavailable } from '@repo/sync/types/server-unavailable';
import { Effect } from 'effect';

function rejected(transaction: Transaction, code: string, reason: string): Outcome {
  return { transactionId: transaction.id, status: 'rejected', syncId: null, reason, code };
}

/** The built-in refusals that the server itself gives, outside a server change. */
const unknownCommand: BuiltInRefusal = 'unknown-command';
const failed: BuiltInRefusal = 'failed';

/**
 * Runs one transaction through its server change and the event log, and
 * gives its outcome. A refusal, an unknown command, a server error and a
 * defect are each an outcome with a stable code. A defect is a broken rule of
 * the server, such as a record that does not fit its contract. It ends as
 * `failed`, which is final, so the client drops the write and does not send
 * it again.
 *
 * A failure that is no refusal may be one dropped connection, so the change
 * runs once more. When it fails again, the server asks its database for the
 * head of the log. A database that answers means the change itself fails,
 * which is final. A database that does not answer means the write was not
 * tried: `settle` fails with `ServerUnavailable`, and the client keeps the
 * write. The sync socket and each agent tool both settle a transaction here,
 * so the same command gives the same outcome however it arrives.
 */
export function settle<R>(
  change: ServerChange<R> | undefined,
  transaction: Transaction,
  actor: Actor,
): Effect.Effect<Outcome, ServerUnavailable, R | EventLog> {
  if (!change) {
    return Effect.succeed(
      rejected(transaction, unknownCommand, `The server has no command ${transaction.command}.`),
    );
  }
  const finalFailure = rejected(transaction, failed, 'The server could not apply this change.');
  return Effect.gen(function* () {
    const log = yield* EventLog;
    const commit = log.commit(actor.organizationId, transaction.id, (db) =>
      change.run(transaction.input, { db, actor }),
    );
    return yield* commit.pipe(
      Effect.catchIf(
        (failure) => !(failure instanceof CommandRejected),
        () => commit,
      ),
      Effect.matchEffect({
        onSuccess: (syncId) =>
          Effect.succeed<Outcome>({
            transactionId: transaction.id,
            status: 'accepted',
            syncId,
            reason: null,
            code: null,
          }),
        onFailure: (failure) =>
          failure instanceof CommandRejected
            ? Effect.succeed(rejected(transaction, failure.code, failure.reason))
            : log.head(actor.organizationId).pipe(
                Effect.mapError(() => new ServerUnavailable()),
                Effect.andThen(Effect.logError('A server change failed', failure)),
                Effect.as(finalFailure),
              ),
      }),
      Effect.catchDefect((defect) =>
        Effect.logError('A server change broke a rule of the server', defect).pipe(
          Effect.as(finalFailure),
        ),
      ),
    );
  });
}
