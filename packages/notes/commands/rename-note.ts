import { noteRecord, renameNote } from '@repo/notes/contract/notes';
import { localChange } from '@repo/sync/contract/command';

/** The local change of `notes/rename`: the new title shows at once. */
export const renameNoteLocal = localChange(renameNote, (draft, input) => {
  const note = draft.get(noteRecord, input.id);
  if (note) {
    draft.put(noteRecord, { ...note, title: input.title, updatedAt: input.at });
  }
});
