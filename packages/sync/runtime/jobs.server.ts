import { sweepJobsHourly } from '@repo/sync/jobs/sweep-jobs';
import { trimLogHourly } from '@repo/sync/jobs/trim-log';

/** The schedules of the sync engine. The server app passes them to `JobRunner`. */
export const syncSchedules = [sweepJobsHourly, trimLogHourly];
