import type { DrizzleDatabase } from '@repo/sync/service/database';
import { Context, Schema } from 'effect';
import type { Effect, Stream } from 'effect';

/**
 * A signal from one server process to the others. `commit` names an
 * organization whose log has a new event. `end` names a user whose session
 * ended. `listening` comes from the wake itself, each time it starts to
 * listen again: a signal sent while it did not listen is lost, so each
 * reader reads its log again.
 */
export const WakeSignal = Schema.Union([
  Schema.Struct({ kind: Schema.Literal('commit'), organizationId: Schema.String }),
  Schema.Struct({ kind: Schema.Literal('end'), userId: Schema.String }),
  Schema.Struct({ kind: Schema.Literal('listening') }),
]);
export type WakeSignal = typeof WakeSignal.Type;

/**
 * The wake between the processes of one server, such as two API processes
 * and a job runner over one database. It carries no delta: a process that
 * hears `commit` reads the new events from the log itself, so the order comes
 * from the log. A process never hears its own signals.
 */
export class Wake extends Context.Service<
  Wake,
  {
    /** Tells each other process now. It fails when the database does not take the signal. */
    readonly send: (signal: WakeSignal) => Effect.Effect<void, unknown>;
    /**
     * Tells each other process when `tx`, a database transaction, commits.
     * Postgres sends the signal with the commit, and drops it on a rollback.
     * So a commit that succeeds always sends it, and a failed one never does.
     */
    readonly sendOnCommit: (
      tx: DrizzleDatabase,
      signal: WakeSignal,
    ) => Effect.Effect<void, unknown>;
    /** Each signal from another process, from the time the stream starts. */
    readonly signals: Stream.Stream<WakeSignal>;
  }
>()('sync/Wake') {}
