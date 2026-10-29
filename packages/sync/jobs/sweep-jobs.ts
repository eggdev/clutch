import { deleteDoneJobs } from '@repo/sync/repo/jobs';
import { Database } from '@repo/sync/service/database';
import { defineJob, defineSchedule } from '@repo/sync/service/jobs';
import { Clock, Duration, Effect, Schema } from 'effect';

/** Done jobs stay this long, for a person to read, then this job deletes them. */
const keepDoneJobs = Duration.days(7);

/** Deletes done jobs older than seven days. Failed jobs stay. */
const sweepJobs = defineJob({
  name: 'sync/sweep-jobs',
  payload: Schema.Struct({}),
  run: () =>
    Effect.gen(function* () {
      const db = yield* Database;
      const now = yield* Clock.currentTimeMillis;
      yield* deleteDoneJobs(db, new Date(now - Duration.toMillis(keepDoneJobs)));
    }),
});

/** Sweeps the outbox once an hour. */
export const sweepJobsHourly = defineSchedule('sync/sweep-jobs', {
  every: '1 hour',
  job: sweepJobs,
  payload: {},
});
