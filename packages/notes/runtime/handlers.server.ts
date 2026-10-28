import { createNoteServer } from '@repo/notes/commands/create-note.server';
import { renameNoteServer } from '@repo/notes/commands/rename-note.server';

/** The server change of each notes command. The server app passes them to `SyncServer`. */
export const notesServerChanges = [createNoteServer, renameNoteServer];
