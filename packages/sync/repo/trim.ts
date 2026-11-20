import { syncEvents, syncRecords } from '@repo/sync/repo/schema';
import type { DrizzleDatabase } from '@repo/sync/service/database';
import { eq, min, sql } from 'drizzle-orm';
import { Effect } from 'effect';

/** The oldest sync ID that the log of an organization still holds, or 0 when it holds none. */
export function oldestOf(db: DrizzleDatabase, organizationId: string) {
  return db
    .select({ oldest: min(syncEvents.syncId) })
    .from(syncEvents)
    .where(eq(syncEvents.organizationId, organizationId))
    .pipe(Effect.map((rows) => rows[0]?.oldest ?? 0));
}

/**
 * Trims the log of each organization. It deletes each event up to the newest
 * one written before `before`, so the log keeps one run of sync IDs with no
 * gap. A cut by time alone could leave a gap, because an event gets its time
 * when its transaction starts, and its sync ID when it takes the lock. The
 * newest event of each organization stays, so its head stays right. Then it
 * deletes each record marked deleted whose last change is older than the
 * oldest event kept. A client that missed that delete is behind the log, and
 * loads again from 0.
 */
export function trimLog(db: DrizzleDatabase, before: Date) {
  return Effect.gen(function* () {
    yield* db.execute(
      sql`with bound as (
          select organization_id,
            max(sync_id) filter (where created_at < ${before.toISOString()}::timestamptz) as upto,
            max(sync_id) as head
          from ${syncEvents}
          group by organization_id
        )
        delete from ${syncEvents} as event
        using bound
        where event.organization_id = bound.organization_id
          and event.sync_id <= bound.upto
          and event.sync_id < bound.head`,
    );
    yield* db.execute(
      sql`delete from ${syncRecords} as record
        where record.deleted
          and record.sync_id < (
            select min(event.sync_id) from ${syncEvents} as event
            where event.organization_id = record.organization_id
          )`,
    );
  });
}
