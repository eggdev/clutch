import { syncRecords } from '@repo/sync/repo/schema';
import type { DrizzleDatabase } from '@repo/sync/service/database';
import type { Delta } from '@repo/sync/types/protocol';
import { and, arrayContains, arrayOverlaps, asc, eq, not, sql } from 'drizzle-orm';
import { Effect } from 'effect';

/** The key of the last record of a page. The next page starts after it. */
export type RecordCursor = { readonly model: string; readonly recordId: string };

/**
 * Up to `limit` live records of a group, after `after`, in the order of their
 * key. A deleted record is not read. A record that is also in a group of
 * `skip` is not read either, because the client gets it there. Each record
 * comes as a delta of its last change, with the sync ID of that change. The
 * order is by key, not by sync ID, so a record that changes while the pages
 * go out keeps its place.
 */
export function liveRecords(
  db: DrizzleDatabase,
  organizationId: string,
  group: string,
  skip: ReadonlySet<string>,
  after: RecordCursor | undefined,
  limit: number,
) {
  return db
    .select()
    .from(syncRecords)
    .where(
      and(
        eq(syncRecords.organizationId, organizationId),
        eq(syncRecords.deleted, false),
        arrayContains(syncRecords.groups, [group]),
        skip.size ? not(arrayOverlaps(syncRecords.groups, [...skip])) : undefined,
        after
          ? sql`(${syncRecords.model}, ${syncRecords.recordId}) > (${after.model}, ${after.recordId})`
          : undefined,
      ),
    )
    .orderBy(asc(syncRecords.model), asc(syncRecords.recordId))
    .limit(limit)
    .pipe(
      Effect.map((rows) => {
        const last = rows.at(-1);
        return {
          deltas: rows.map((row): Delta => ({
            syncId: row.syncId,
            transactionId: null,
            changes: [
              {
                model: row.model,
                id: row.recordId,
                action: 'upsert',
                data: row.data,
                groups: row.groups,
              },
            ],
          })),
          last: last ? { model: last.model, recordId: last.recordId } : undefined,
          full: rows.length === limit,
        };
      }),
    );
}
