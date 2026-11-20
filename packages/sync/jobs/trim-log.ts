import { syncLogKeepDays } from '@repo/sync/config/log-retention';
import { job } from '@repo/sync/contract/job';
import { trimLog } from '@repo/sync/repo/trim';
import { Database } from '@repo/sync/service/database';
import { defineJob, defineSchedule } from '@repo/sync/service/jobs';
import { Clock, Duration, Effect, Option } from 'effect';

/** The declaration of the trim job. The sync engine has no contract, so it declares the job here. */
const trimLogDeclaration = job('sync/trim-log', { payload: {} });

/** Trims the events older than `SYNC_LOG_KEEP_DAYS`. With no value, it does nothing. */
export const trimLogJob = defineJob(trimLogDeclaration, () =>
  Effect.gen(function* () {
    const keepDays = yield* syncLogKeepDays;
    if (Option.isNone(keepDays)) {
      return;
    }
    const db = yield* Database;
    const now = yield* Clock.currentTimeMillis;
    yield* trimLog(db, new Date(now - Duration.toMillis(Duration.days(keepDays.value))));
  }),
);

/** Trims the log once an hour. */
export const trimLogHourly = defineSchedule('sync/trim-log', {
  every: '1 hour',
  job: trimLogJob,
  payload: {},
});
