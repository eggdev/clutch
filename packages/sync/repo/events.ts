import { syncCounters, syncEvents, syncRecords } from '@repo/sync/repo/schema';
import type { DrizzleDatabase } from '@repo/sync/service/database';
import type { Change, Delta } from '@repo/sync/types/protocol';
import { and, arrayOverlaps, asc, eq, gt, max, or, sql } from 'drizzle-orm';
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

/** One key for each record of an organization. */
const recordKey = (change: { readonly model: string; readonly id: string }) =>
  `${change.model}\u0000${change.id}`;

/** The groups of each record before this event, from its stored state. A deleted record had none. */
function groupsBefore(db: DrizzleDatabase, organizationId: string, changes: ReadonlyArray<Change>) {
  const keys = [...new Map(changes.map((change) => [recordKey(change), change])).values()];
  if (keys.length === 0) {
    return Effect.succeed(new Map<string, ReadonlyArray<string>>());
  }
  return db
    .select({
      model: syncRecords.model,
      recordId: syncRecords.recordId,
      groups: syncRecords.groups,
      deleted: syncRecords.deleted,
    })
    .from(syncRecords)
    .where(
      and(
        eq(syncRecords.organizationId, organizationId),
        or(
          ...keys.map((change) =>
            and(eq(syncRecords.model, change.model), eq(syncRecords.recordId, change.id)),
          ),
        ),
      ),
    )
    .pipe(
      Effect.map(
        (rows) =>
          new Map(
            rows.map((row) => [
              recordKey({ model: row.model, id: row.recordId }),
              row.deleted ? [] : row.groups,
            ]),
          ),
      ),
    );
}

/**
 * Each change with the groups that its record leaves: the groups it was in
 * before, and is not in after. The changes of one event apply in order, so a
 * second change of a record leaves the groups of the first. The map ends with
 * the groups of each record after the event.
 */
function withLeft(changes: ReadonlyArray<Change>, groups: Map<string, ReadonlyArray<string>>) {
  return changes.map((change): Change => {
    const key = recordKey(change);
    const left = (groups.get(key) ?? []).filter((group) => !change.groups.includes(group));
    groups.set(key, change.action === 'delete' ? [] : change.groups);
    const { left: _given, ...rest } = change;
    return left.length ? { ...rest, left } : rest;
  });
}

/** Writes the last state of each record that the changes touch. The last change of a record wins. */
function saveRecords(
  db: DrizzleDatabase,
  organizationId: string,
  syncId: number,
  changes: ReadonlyArray<Change>,
) {
  const last = new Map(changes.map((change) => [recordKey(change), change]));
  const rows = [...last.values()].map((change) => ({
    organizationId,
    model: change.model,
    recordId: change.id,
    groups: [...change.groups],
    syncId,
    data: change.data,
    deleted: change.action === 'delete',
  }));
  if (rows.length === 0) {
    return Effect.void;
  }
  return db
    .insert(syncRecords)
    .values(rows)
    .onConflictDoUpdate({
      target: [syncRecords.organizationId, syncRecords.model, syncRecords.recordId],
      set: {
        groups: sql`excluded.groups`,
        syncId: sql`excluded.sync_id`,
        data: sql`excluded.data`,
        deleted: sql`excluded.deleted`,
      },
    })
    .pipe(Effect.asVoid);
}

/**
 * Appends one event. It locks the organization's counter row, so two writes
 * in one organization get sync IDs in commit order. Run it inside the
 * transaction that wrote the changes. After the lock, it reads the stored
 * state of each record, so each change names the groups that its record
 * leaves, and it writes the new state. The event's groups are the groups of
 * all its changes, with the groups that they leave, so the clients of an old
 * group find the event. It returns the changes as stored.
 */
export function appendEvent(
  db: DrizzleDatabase,
  organizationId: string,
  transactionId: string | null,
  given: ReadonlyArray<Change>,
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
    const changes = withLeft(given, yield* groupsBefore(db, organizationId, given));
    yield* saveRecords(db, organizationId, syncId, changes);
    const groups = [
      ...new Set(changes.flatMap((change) => [...change.groups, ...(change.left ?? [])])),
    ];
    yield* db.insert(syncEvents).values({ organizationId, syncId, transactionId, changes, groups });
    return { syncId, changes };
  });
}

/**
 * Builds the state of each record from the events of the log, when the log
 * has events and no state yet. A server before the state table kept none, so
 * this runs once after the migration that adds it. The last change of each
 * record wins, and a later run finds rows and does nothing.
 */
export function fillRecords(db: DrizzleDatabase) {
  return db
    .execute(
      sql`insert into ${syncRecords} (organization_id, model, record_id, groups, sync_id, data, deleted)
        select distinct on (event.organization_id, item.change->>'model', item.change->>'id')
          event.organization_id,
          item.change->>'model',
          item.change->>'id',
          array(select jsonb_array_elements_text(item.change->'groups')),
          event.sync_id,
          nullif(item.change->'data', 'null'::jsonb),
          item.change->>'action' = 'delete'
        from ${syncEvents} as event
          cross join lateral jsonb_array_elements(event.changes) with ordinality as item(change, position)
        where not exists (select 1 from ${syncRecords})
        order by event.organization_id, item.change->>'model', item.change->>'id',
          event.sync_id desc, item.position desc
        on conflict do nothing`,
    )
    .pipe(Effect.asVoid);
}

/** The newest sync ID of an organization, or 0 when its log is empty. */
export function headOf(db: DrizzleDatabase, organizationId: string) {
  return db
    .select({ head: max(syncEvents.syncId) })
    .from(syncEvents)
    .where(eq(syncEvents.organizationId, organizationId))
    .pipe(Effect.map((rows) => rows[0]?.head ?? 0));
}

/** The delta of each event row, with every change it stores. */
function deltasOf(
  rows: ReadonlyArray<{
    syncId: number;
    transactionId: string | null;
    changes: ReadonlyArray<Change>;
  }>,
): ReadonlyArray<Delta> {
  return rows.map((row) => ({
    syncId: row.syncId,
    transactionId: row.transactionId,
    changes: row.changes,
  }));
}

/**
 * Up to `limit` events after `lastSyncId` that touch `groups`, oldest first, with every change they store. `last` is
 * the sync ID of the last event read, so the next page starts after it. The
 * caller picks what a client sees.
 */
export function eventsAfter(
  db: DrizzleDatabase,
  organizationId: string,
  lastSyncId: number,
  groups: ReadonlySet<string>,
  limit: number,
) {
  return db
    .select()
    .from(syncEvents)
    .where(
      and(
        eq(syncEvents.organizationId, organizationId),
        gt(syncEvents.syncId, lastSyncId),
        arrayOverlaps(syncEvents.groups, [...groups]),
      ),
    )
    .orderBy(asc(syncEvents.syncId))
    .limit(limit)
    .pipe(
      Effect.map((rows) => ({
        deltas: deltasOf(rows),
        last: rows.at(-1)?.syncId,
        full: rows.length === limit,
      })),
    );
}

/**
 * Up to `limit` events of an organization after `lastSyncId`, oldest first,
 * whatever their groups. The live reader of each process reads the new events
 * with it. `last` is the sync ID of the last event read.
 */
export function eventsSince(
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
      Effect.map((rows) => ({
        deltas: deltasOf(rows),
        last: rows.at(-1)?.syncId,
        full: rows.length === limit,
      })),
    );
}
