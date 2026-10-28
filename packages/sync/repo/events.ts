import { syncCounters, syncEvents } from '@repo/sync/repo/schema';
import type { DrizzleDatabase } from '@repo/sync/service/database';
import type { Change, Delta } from '@repo/sync/types/protocol';
import { and, asc, eq, gt } from 'drizzle-orm';
import { Effect } from 'effect';

/** The sync ID of a transaction that the log already holds, so a resent transaction applies once. */
export function findTransaction(
  db: DrizzleDatabase,
  organizationId: string,
  transactionId: string,
) {
  return db
    .select({ syncId: syncEvents.syncId })
    .from(syncEvents)
    .where(
      and(
        eq(syncEvents.organizationId, organizationId),
        eq(syncEvents.transactionId, transactionId),
      ),
    )
    .pipe(Effect.map((rows) => rows[0]?.syncId));
}

/**
 * Appends one event. It locks the organization's counter row, so two writes
 * in one organization get sync IDs in commit order. Run it inside the
 * transaction that wrote the changes.
 */
export function appendEvent(
  db: DrizzleDatabase,
  organizationId: string,
  transactionId: string | null,
  changes: ReadonlyArray<Change>,
) {
  return Effect.gen(function* () {
    yield* db.insert(syncCounters).values({ organizationId, nextSyncId: 1 }).onConflictDoNothing();
    const [counter] = yield* db
      .select()
      .from(syncCounters)
      .where(eq(syncCounters.organizationId, organizationId))
      .for('update');
    const syncId = counter?.nextSyncId ?? 1;
    yield* db
      .update(syncCounters)
      .set({ nextSyncId: syncId + 1 })
      .where(eq(syncCounters.organizationId, organizationId));
    yield* db.insert(syncEvents).values({ organizationId, syncId, transactionId, changes });
    return syncId;
  });
}

/** Up to `limit` events after `lastSyncId`, oldest first. */
export function eventsAfter(
  db: DrizzleDatabase,
  organizationId: string,
  lastSyncId: number,
  limit: number,
) {
  return db
    .select()
    .from(syncEvents)
    .where(and(eq(syncEvents.organizationId, organizationId), gt(syncEvents.syncId, lastSyncId)))
    .orderBy(asc(syncEvents.syncId))
    .limit(limit)
    .pipe(
      Effect.map((rows): ReadonlyArray<Delta> =>
        rows.map((row) => ({
          syncId: row.syncId,
          transactionId: row.transactionId,
          changes: row.changes,
        })),
      ),
    );
}
