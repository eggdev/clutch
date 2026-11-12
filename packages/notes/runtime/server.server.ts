import { createNoteServer } from '@repo/notes/commands/create-note.server';
import { renameNoteServer } from '@repo/notes/commands/rename-note.server';
import { notesContract } from '@repo/notes/contract/notes';
import { countNotes } from '@repo/notes/jobs/count-notes';
import { importNoteRoute } from '@repo/notes/runtime/routes.server';
import type { DrizzleDatabase } from '@repo/sync/service/database';
import { migratePackage } from '@repo/sync/service/migrations';
import { serverPackage } from '@repo/sync/service/server-package.server';

/** Runs the migrations of the notes tables. */
export function migrateNotes(db: DrizzleDatabase) {
  return migratePackage(db, 'notes', new URL('../repo/migrations', import.meta.url));
}

/**
 * The server half of the notes package: its server change of each command, its
 * jobs, its HTTP routes and its migrations. A command with no server change
 * here, or a declared job or route with no code, does not compile. The server
 * app lists it in `packages`.
 */
export const notesServer = serverPackage(notesContract, {
  changes: [createNoteServer, renameNoteServer],
  jobs: [countNotes],
  routes: [importNoteRoute],
  migrate: migrateNotes,
});
