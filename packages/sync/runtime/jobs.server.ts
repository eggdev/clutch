import { sweepJobsHourly } from '@repo/sync/jobs/sweep-jobs';

/** The schedules of the sync engine. The server app passes them to `JobRunner`. */
export const syncSchedules = [sweepJobsHourly];
