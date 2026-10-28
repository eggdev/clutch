import { accessTables } from '@repo/access/testing/access';
import { migrateNotes } from '@repo/notes/runtime/migrate.server';
import { NotesLive } from '@repo/notes/service/notes';
import { DatabaseTest } from '@repo/sync/testing/database';
import { Layer } from 'effect';

/** A fresh in-memory database with the notes tables, and the access tables that its checks read. */
export const NotesDatabaseTest = () => DatabaseTest(accessTables, migrateNotes);

/** The `Notes` service over a fresh in-memory database. */
export const NotesTest = () => Layer.provideMerge(NotesLive, NotesDatabaseTest());
