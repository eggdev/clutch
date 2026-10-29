import { SyncGroupsFromAccess } from '@repo/access/service/access';
import { accessTables } from '@repo/access/testing/access';
import { migrateNotes } from '@repo/notes/runtime/migrate.server';
import { NotesLive } from '@repo/notes/service/notes';
import { OutboxLive } from '@repo/sync/service/jobs';
import { DatabaseTest } from '@repo/sync/testing/database';
import { Layer } from 'effect';

/** A fresh in-memory database with the notes tables, and the access tables that its checks read. */
export const NotesDatabaseTest = () => DatabaseTest(accessTables, migrateNotes);

/**
 * The `Notes` service, the `SyncGroups` seam that the notes server changes use
 * for their access rule, and the outbox, over a fresh in-memory database.
 */
export const NotesTest = () =>
  Layer.provideMerge(
    Layer.mergeAll(NotesLive, SyncGroupsFromAccess, OutboxLive),
    NotesDatabaseTest(),
  );
