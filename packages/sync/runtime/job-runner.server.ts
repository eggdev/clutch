import { claimJobs, failJob, finishJob, insertJob } from '@repo/sync/repo/jobs';
import type { JobRow } from '@repo/sync/repo/schema';
import { Database } from '@repo/sync/service/database';
import { EventLog } from '@repo/sync/service/event-log';
import type { JobContext, JobSchedule, RunnableJob } from '@repo/sync/service/jobs';
import { Cause, Clock, Duration, Effect, Layer } from 'effect';

/** A job runs at most this many times. Then it stays `failed` for a person to read. */
const maxAttempts = 5;
/** How long a claimed job stays locked. A server that stops frees its jobs after this. */
const lockFor = Duration.minutes(5);
/** The longest wait between two attempts. */
const longestWait = Duration.minutes(5);

/** The wait before the next attempt: 1 s, 2 s, 4 s, and so on, up to five minutes. */
export function retryWait(attempts: number) {
  return Math.min(1000 * 2 ** attempts, Duration.toMillis(longestWait));
}

function contextOf(job: JobRow, log: EventLog['Service']): JobContext {
  return {
    jobId: job.id,
    organizationId: job.organizationId,
    attempt: job.attempts + 1,
    commit: (write) =>
      job.organizationId === null
        ? Effect.die(new Error(`The job ${job.id} has no organization, so it cannot commit.`))
        : log.commit(job.organizationId, `job:${job.id}`, write),
  };
}

/**
 * Claims the due jobs and runs each one. A success marks it done. A failure
 * records the error and asks for the job again later, or marks it `failed`
 * after the last attempt. Returns how many jobs ran.
 */
export function runDueJobs<R>(jobs: ReadonlyArray<RunnableJob<R>>, limit = 20) {
  const byName = new Map(jobs.map((job) => [job.name, job]));
  return Effect.gen(function* () {
    const db = yield* Database;
    const log = yield* EventLog;
    const now = yield* Clock.currentTimeMillis;
    const claimed = yield* claimJobs(
      db,
      new Date(now),
      new Date(now + Duration.toMillis(lockFor)),
      limit,
    );
    for (const row of claimed) {
      const job = byName.get(row.name);
      const outcome = job
        ? yield* job.execute(row.payload, contextOf(row, log)).pipe(Effect.exit)
        : undefined;
      const at = yield* Clock.currentTimeMillis;
      if (outcome?._tag === 'Success') {
        yield* finishJob(db, row.id, new Date(at));
      } else {
        const error = outcome
          ? Cause.pretty(outcome.cause)
          : `This server has no job named ${row.name}.`;
        const last = row.attempts + 1 >= maxAttempts;
        yield* failJob(
          db,
          row,
          error,
          last ? null : new Date(at + retryWait(row.attempts)),
          new Date(at),
        );
      }
    }
    return claimed.length;
  });
}

/** Asks for each scheduled job of the current interval. Each interval has one job ID. */
export function askForScheduledJobs<R>(schedules: ReadonlyArray<JobSchedule<R>>) {
  return Effect.gen(function* () {
    const db = yield* Database;
    const now = yield* Clock.currentTimeMillis;
    for (const schedule of schedules) {
      const slot = Math.floor(now / Duration.toMillis(schedule.every));
      yield* insertJob(
        db,
        {
          id: `schedule:${schedule.name}:${slot}`,
          organizationId: null,
          name: schedule.job.name,
          payload: schedule.payload,
          runAt: new Date(now),
        },
        new Date(now),
      );
    }
  });
}

/**
 * The job runner of a server app. At each tick it asks for the scheduled jobs
 * and runs the due ones. A tick that fails is logged, and the next tick runs.
 * `jobs` lists every job; the jobs of `schedules` are added to it.
 */
export function JobRunner<R>(
  jobs: ReadonlyArray<RunnableJob<R>>,
  schedules: ReadonlyArray<JobSchedule<R>>,
  tick: Duration.Input = '500 millis',
) {
  const all = [...jobs, ...schedules.map((schedule) => schedule.job)];
  return Layer.effectDiscard(
    askForScheduledJobs(schedules).pipe(
      Effect.andThen(runDueJobs(all)),
      Effect.catchCause((cause) => Effect.logError('A job runner tick failed', cause)),
      Effect.andThen(Effect.sleep(tick)),
      Effect.forever,
      Effect.forkScoped,
    ),
  );
}
