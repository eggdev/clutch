import { noteModel } from '@repo/notes/models/note';
import { notes } from '@repo/notes/repo/schema';
import type { NoteRow } from '@repo/notes/repo/schema';
import type { Note } from '@repo/notes/types/note';
import { upsertChange } from '@repo/sync/models/change';
import type { DrizzleDatabase } from '@repo/sync/service/database';
import { and, eq } from 'drizzle-orm';
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
  return upsertChange(noteModel, toRecord(row), { organizationId: row.organizationId });
}

export function findNote(db: DrizzleDatabase, organizationId: string, id: string) {
  return db
    .select()
    .from(notes)
    .where(and(eq(notes.id, id), eq(notes.organizationId, organizationId)))
    .pipe(Effect.map((rows) => rows[0]));
}

export function insertNote(db: DrizzleDatabase, row: NoteRow) {
  return db
    .insert(notes)
    .values(row)
    .returning()
    .pipe(Effect.map((rows) => rows[0] ?? row));
}

export function updateTitle(db: DrizzleDatabase, row: NoteRow, title: string, at: Date) {
  return db
    .update(notes)
    .set({ title, updatedAt: at })
    .where(and(eq(notes.id, row.id), eq(notes.organizationId, row.organizationId)))
    .returning()
    .pipe(Effect.map((rows) => rows[0] ?? { ...row, title, updatedAt: at }));
}
