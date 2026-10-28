import { createNote } from '@repo/notes/commands/create-note';
import { renameNote } from '@repo/notes/commands/rename-note';

/** The client half of each notes command. The web app gives them to the object pool. */
export const notesCommands = [createNote, renameNote];
