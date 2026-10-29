import { insertJob } from '@repo/sync/repo/jobs';
import type { DrizzleDatabase } from '@repo/sync/service/database';
import { transactionSafe } from '@repo/sync/service/transaction-safe';
import type { Change } from '@repo/sync/types/protocol';
import { Clock, Context, Duration, Effect, Layer, Schema } from 'effect';

/** What a job receives as it runs. */
export type JobContext = {
  readonly jobId: string;
  readonly organizationId: string | null;
  readonly attempt: number;
  /**
   * Commits changes to the event log as the system actor, so each client of
   * their sync groups gets a delta. The job ID makes a retry commit once.
   */
  readonly commit: (
    write: (db: DrizzleDatabase) => Effect.Effect<ReadonlyArray<Change>, unknown>,
  ) => Effect.Effect<number, unknown>;
};

/** A job as the job runner sees it: a name, and a way to decode and run a payload. */
export type RunnableJob<R = never> = {
  readonly name: string;
  readonly execute: (payload: unknown, context: JobContext) => Effect.Effect<void, unknown, R>;
};

/** A job, with the payload type that `enqueue` checks. */
export type Job<Payload, R = never> = RunnableJob<R> & {
  readonly encode: (payload: Payload) => unknown;
};

/**
 * Defines a job. A job runs after the commit that asked for it, so it may use
 * any service, a vendor service too. It may fail: the job runner tries it
 * again with a growing wait. Make `run` safe to repeat.
 */
export function defineJob<Payload, Encoded, R = never>(definition: {
  readonly name: string;
  readonly payload: Schema.Codec<Payload, Encoded>;
  readonly run: (payload: Payload, context: JobContext) => Effect.Effect<void, unknown, R>;
}): Job<Payload, R> {
  const decode = Schema.decodeUnknownEffect(definition.payload);
  const encode = Schema.encodeSync(definition.payload);
  return {
    name: definition.name,
    encode,
    execute: (payload, context) =>
      decode(payload).pipe(Effect.flatMap((value) => definition.run(value, context))),
  };
}

/** Where and when a job runs. The ID makes a repeated request do nothing new. */
export type JobOptions = {
  readonly id: string;
  readonly organizationId: string | null;
  readonly delay?: Duration.Input;
};

/**
 * The outbox. A server change, a route or a schedule asks for a job here. It
 * writes the job in the transaction it is given, so the job exists only if
 * that transaction commits. It is transaction-safe.
 */
export class Outbox extends Context.Service<
  Outbox,
  {
    readonly [transactionSafe]: true;
    readonly enqueue: <Payload, R>(
      db: DrizzleDatabase,
      job: Job<Payload, R>,
      payload: Payload,
      options: JobOptions,
    ) => Effect.Effect<void, unknown>;
  }
>()('sync/Outbox') {}

export const OutboxLive = Layer.succeed(Outbox)({
  [transactionSafe]: true,
  enqueue: (db, job, payload, options) =>
    Effect.gen(function* () {
      const now = yield* Clock.currentTimeMillis;
      const wait = options.delay === undefined ? 0 : Duration.toMillis(options.delay);
      yield* insertJob(
        db,
        {
          id: options.id,
          organizationId: options.organizationId,
          name: job.name,
          payload: job.encode(payload),
          runAt: new Date(now + wait),
        },
        new Date(now),
      );
    }),
});

/** A job that the job runner asks for again at each interval. */
export type JobSchedule<R = never> = {
  readonly name: string;
  readonly every: Duration.Duration;
  readonly job: RunnableJob<R>;
  readonly payload: unknown;
};

/**
 * Asks for a job at each interval. Each interval has one job ID, so two
 * servers that run the same schedule still run the job once.
 */
export function defineSchedule<Payload, R>(
  name: string,
  options: {
    readonly every: Duration.Input;
    readonly job: Job<Payload, R>;
    readonly payload: Payload;
  },
): JobSchedule<R> {
  return {
    name,
    every: Duration.fromInputUnsafe(options.every),
    job: options.job,
    payload: options.job.encode(options.payload),
  };
}
