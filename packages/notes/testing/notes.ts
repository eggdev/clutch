import { migrateNotes } from '@repo/notes/runtime/migrate.server';
import { NotesLive } from '@repo/notes/service/notes';
import { DatabaseTest } from '@repo/sync/testing/database';
import { Layer } from 'effect';

/** A fresh in-memory database with the notes tables. */
export const NotesDatabaseTest = () => DatabaseTest(migrateNotes);

/** The `Notes` service over a fresh in-memory database. */
export const NotesTest = () => Layer.provideMerge(NotesLive, NotesDatabaseTest());
