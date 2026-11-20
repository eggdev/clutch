import type { Actor } from '@repo/identity/types/actor';
import type { ServerChange } from '@repo/sync/commands/server-change.server';
import type { BuiltInRefusal } from '@repo/sync/contract/command';
import { EventLog } from '@repo/sync/service/event-log';
import { CommandRejected } from '@repo/sync/types/command-rejected';
import type { Outcome, Transaction } from '@repo/sync/types/protocol';
import { ServerUnavailable } from '@repo/sync/types/server-unavailable';
import { Cause, Effect, Option } from 'effect';
import { SqlError } from 'effect/sql';

function rejected(transaction: Transaction, code: string, reason: string): Outcome {
  return { transactionId: transaction.id, status: 'rejected', syncId: null, reason, code };
}

/**
 * The Postgres codes of a failure that passes: a serialization failure, a
 * deadlock and a lock that is not free. A code of the class `08`, or one of
 * `57P01` to `57P03`, is a connection that dropped or a server that stops.
 */
const passingCodes = /^(?:40001|40P01|55P03|08...|57P0[123])$/u;

/** The reasons of `SqlError` that both drivers give for those codes, and for a dropped connection. */
const passingReasons = new Set([
  'SerializationError',
  'DeadlockError',
  'LockTimeoutError',
  'ConnectionError',
]);

/**
 * Whether a failure of a server change passes, so the same change can work a
 * moment later. It takes a failure, a defect or a whole `Cause`. Drizzle wraps the error of the driver in a query error whose
 * `cause` is an Effect `Cause`. The `SqlError` of the driver holds a reason,
 * and the reason holds the error of the server with its `code`. The Postgres
 * driver and PGlite both give the same reasons, and the code stays on the
 * error of the server, so the check reads the reason and the code at each
 * step of the chain.
 */
export function passingFailure(failure: unknown, depth = 0): boolean {
  if (depth > 8 || typeof failure !== 'object' || failure === null) {
    return false;
  }
  if (Cause.isCause(failure)) {
    return failure.reasons.some(
      (reason) =>
        (Cause.isFailReason(reason) && passingFailure(reason.error, depth + 1)) ||
        (Cause.isDieReason(reason) && passingFailure(reason.defect, depth + 1)),
    );
  }
  if (SqlError.isSqlErrorReason(failure) && passingReasons.has(failure._tag)) {
    return true;
  }
  const code: unknown = Reflect.get(failure, 'code');
  if (typeof code === 'string' && passingCodes.test(code)) {
    return true;
  }
  return passingFailure(Reflect.get(failure, 'cause'), depth + 1);
}

/** The most runs of a server change after a failure that passes. */
const passingTries = 5;

/** The wait before run `n` after a failure that passes: 20 ms, then twice as long each time. */
const passingWait = (n: number) => `${20 * 2 ** n} millis` as const;

/**
 * Runs `commit` again after a failure that passes, up to `passingTries`
 * times with a wait that grows, and once after any other failure that is no
 * refusal, as one dropped connection may be. A connection that drops in a
 * database transaction often ends it as a defect, since its rollback fails
 * too, so a defect that passes runs again as well. When the runs that pass
 * are spent, the last one fails as a failure, not a defect, so `settle`
 * asks the database whether it answers. Every other cause stays as it is.
 */
function withRetries<R>(
  commit: Effect.Effect<number, unknown, R>,
  passingLeft = passingTries,
  otherLeft = 1,
): Effect.Effect<number, unknown, R> {
  return commit.pipe(
    Effect.catchCause((cause) => {
      const failure = Cause.findErrorOption(cause);
      if (Option.isSome(failure) && failure.value instanceof CommandRejected) {
        return Effect.failCause(cause);
      }
      if (passingFailure(cause)) {
        return passingLeft > 0
          ? Effect.sleep(passingWait(passingTries - passingLeft)).pipe(
              Effect.andThen(withRetries(commit, passingLeft - 1, otherLeft)),
            )
          : Effect.fail(Cause.squash(cause));
      }
      if (Option.isSome(failure) && otherLeft > 0) {
        return withRetries(commit, passingLeft, otherLeft - 1);
      }
      return Effect.failCause(cause);
    }),
  );
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
 * A failure of the database that passes, such as a deadlock, a
 * serialization failure, a lock that is not free or a dropped connection,
 * runs the change again, up to 5 times, with a wait that grows from 20 ms.
 * Any other failure that is no refusal runs the change once more. When the
 * runs fail, the server asks its database for the head of the log. A
 * database that answers means the change itself fails, which is final. A
 * database that does not answer means the write was not tried: `settle`
 * fails with `ServerUnavailable`, and the client keeps the write. The sync socket and each agent tool both settle a transaction here,
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
    return yield* withRetries(commit).pipe(
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
