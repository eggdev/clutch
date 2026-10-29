import { outboxJobs } from '@repo/sync/repo/schema';
import type { JobRow } from '@repo/sync/repo/schema';
import type { DrizzleDatabase } from '@repo/sync/service/database';
import { and, eq, inArray, lt, lte, or } from 'drizzle-orm';
import { Effect } from 'effect';

/** A job to write in the outbox. */
export type NewJob = {
  readonly id: string;
  readonly organizationId: string | null;
  readonly name: string;
  readonly payload: unknown;
  readonly runAt: Date;
};

/** Writes a job. A job with the same ID already in the outbox stays as it is. */
export function insertJob(db: DrizzleDatabase, job: NewJob, now: Date) {
  return db
    .insert(outboxJobs)
    .values({ ...job, status: 'pending', attempts: 0, createdAt: now })
    .onConflictDoNothing();
}

/**
 * Claims up to `limit` due jobs and marks them running until `lockedUntil`.
 * A running job whose lock ended, because its server stopped, is due again.
 * `SKIP LOCKED` lets two servers claim different jobs at the same time.
 */
export function claimJobs(db: DrizzleDatabase, now: Date, lockedUntil: Date, limit: number) {
  return db.transaction((tx) =>
    Effect.gen(function* () {
      const due = yield* tx
        .select({ id: outboxJobs.id })
        .from(outboxJobs)
        .where(
          or(
            and(eq(outboxJobs.status, 'pending'), lte(outboxJobs.runAt, now)),
            and(eq(outboxJobs.status, 'running'), lt(outboxJobs.lockedUntil, now)),
          ),
        )
        .orderBy(outboxJobs.runAt)
        .limit(limit)
        .for('update', { skipLocked: true });
      if (due.length === 0) {
        return [];
      }
      const claimed: ReadonlyArray<JobRow> = yield* tx
        .update(outboxJobs)
        .set({ status: 'running', lockedUntil })
        .where(
          inArray(
            outboxJobs.id,
            due.map((row) => row.id),
          ),
        )
        .returning();
      return claimed;
    }),
  );
}

/** Marks a job done. */
export function finishJob(db: DrizzleDatabase, id: string, now: Date) {
  return db
    .update(outboxJobs)
    .set({ status: 'done', lockedUntil: null, lastError: null, finishedAt: now })
    .where(eq(outboxJobs.id, id));
}

/**
 * Records a failed attempt. The job runs again at `retryAt`, or stays
 * `failed` when `retryAt` is `null`, for a person to read `last_error`.
 */
export function failJob(
  db: DrizzleDatabase,
  job: JobRow,
  error: string,
  retryAt: Date | null,
  now: Date,
) {
  return db
    .update(outboxJobs)
    .set(
      retryAt
        ? {
            status: 'pending',
            attempts: job.attempts + 1,
            runAt: retryAt,
            lockedUntil: null,
            lastError: error,
          }
        : {
            status: 'failed',
            attempts: job.attempts + 1,
            lockedUntil: null,
            lastError: error,
            finishedAt: now,
          },
    )
    .where(eq(outboxJobs.id, job.id));
}

/** Deletes done jobs that finished before `before`. Failed jobs stay for a person to read. */
export function deleteDoneJobs(db: DrizzleDatabase, before: Date) {
  return db
    .delete(outboxJobs)
    .where(and(eq(outboxJobs.status, 'done'), lt(outboxJobs.finishedAt, before)));
}

/** Every job of one name. Tests read it. */
export function jobsNamed(db: DrizzleDatabase, name: string) {
  return db.select().from(outboxJobs).where(eq(outboxJobs.name, name));
}
