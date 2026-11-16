import { noteRecord } from '@repo/notes/contract/notes';
import type { Note } from '@repo/notes/contract/notes';
import { notes } from '@repo/notes/repo/schema';
import type { NoteRow } from '@repo/notes/repo/schema';
import { upsertChange } from '@repo/sync/contract/change';
import type { DrizzleDatabase } from '@repo/sync/service/database';
import { storedRow } from '@repo/sync/service/stored-row';
import { and, desc, eq, getTableName } from 'drizzle-orm';
import { Effect } from 'effect';

/** The public record of a row. The table shape stays inside this package. */
export function toRecord(row: NoteRow): Note {
  return {
    id: row.id,
    spaceId: row.spaceId,
    title: row.title,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

export function toRow(note: Note, organizationId: string): NoteRow {
  return {
    id: note.id,
    organizationId,
    spaceId: note.spaceId,
    title: note.title,
    createdAt: new Date(note.createdAt),
    updatedAt: new Date(note.updatedAt),
  };
}

/** The change that tells each member of the note's space about a row. */
export function toChange(row: NoteRow) {
  return upsertChange(noteRecord, toRecord(row), { organizationId: row.organizationId });
}

export function findNote(db: DrizzleDatabase, organizationId: string, id: string) {
  return db
    .select()
    .from(notes)
    .where(and(eq(notes.id, id), eq(notes.organizationId, organizationId)))
    .pipe(Effect.map((rows) => rows[0]));
}

/** The notes of an organization, newest first. */
export function listNotes(db: DrizzleDatabase, organizationId: string) {
  return db
    .select()
    .from(notes)
    .where(eq(notes.organizationId, organizationId))
    .orderBy(desc(notes.createdAt));
}

export function insertNote(db: DrizzleDatabase, row: NoteRow) {
  return db
    .insert(notes)
    .values(row)
    .returning()
    .pipe(Effect.flatMap(storedRow(getTableName(notes))));
}

/** Fails with `RowNotStored` when the note is no longer in the database. */
export function updateTitle(db: DrizzleDatabase, row: NoteRow, title: string, at: Date) {
  return db
    .update(notes)
    .set({ title, updatedAt: at })
    .where(and(eq(notes.id, row.id), eq(notes.organizationId, row.organizationId)))
    .returning()
    .pipe(Effect.flatMap(storedRow(getTableName(notes))));
}
