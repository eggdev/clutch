import { spaceNoteCountModel } from '@repo/notes/models/space-note-count';
import { notes, spaceNoteCounts } from '@repo/notes/repo/schema';
import type { SpaceNoteCountRow } from '@repo/notes/repo/schema';
import type { SpaceNoteCount } from '@repo/notes/types/space-note-count';
import { upsertChange } from '@repo/sync/models/change';
import type { DrizzleDatabase } from '@repo/sync/service/database';
import { and, count, eq } from 'drizzle-orm';
import { Effect } from 'effect';

/** The public record of a count row. The ID is the space ID. */
function toCountRecord(row: SpaceNoteCountRow): SpaceNoteCount {
  return {
    id: row.spaceId,
    spaceId: row.spaceId,
    noteCount: row.noteCount,
    updatedAt: row.updatedAt.toISOString(),
  };
}

/** The change that tells each member of the space about its count. */
export function toCountChange(row: SpaceNoteCountRow) {
  return upsertChange(spaceNoteCountModel, toCountRecord(row), {
    organizationId: row.organizationId,
  });
}

/** Counts the notes of one space in the database, not in a client. */
export function countNotesIn(db: DrizzleDatabase, organizationId: string, spaceId: string) {
  return db
    .select({ total: count() })
    .from(notes)
    .where(and(eq(notes.organizationId, organizationId), eq(notes.spaceId, spaceId)))
    .pipe(Effect.map((rows) => rows[0]?.total ?? 0));
}

/** Writes the count of one space, and returns the row. */
export function saveCount(db: DrizzleDatabase, row: SpaceNoteCountRow) {
  return db
    .insert(spaceNoteCounts)
    .values(row)
    .onConflictDoUpdate({
      target: [spaceNoteCounts.organizationId, spaceNoteCounts.spaceId],
      set: { noteCount: row.noteCount, updatedAt: row.updatedAt },
    })
    .returning()
    .pipe(Effect.map((rows) => rows[0] ?? row));
}
