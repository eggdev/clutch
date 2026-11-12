import { createNoteLocal } from '@repo/notes/commands/create-note';
import { renameNoteLocal } from '@repo/notes/commands/rename-note';
import { notesContract } from '@repo/notes/contract/notes';
import { clientPackage } from '@repo/sync/contract/define';

/**
 * The client half of the notes package: its contract and the local change of
 * each command that shows at once. A command with `waits: 'local'` and no local
 * change here does not compile. The client apps list it in `packages`.
 */
export const notesClient = clientPackage(notesContract, [createNoteLocal, renameNoteLocal]);
