import { Config } from 'effect';

/**
 * How many days the event log keeps its events. Set `SYNC_LOG_KEEP_DAYS` to a
 * whole number of days, and an hourly job trims the older events. When it is
 * not set, the log keeps every event. How long to keep them is the owner's
 * decision, so the template sets no value.
 */
export const syncLogKeepDays = Config.option(Config.Int('SYNC_LOG_KEEP_DAYS'));
