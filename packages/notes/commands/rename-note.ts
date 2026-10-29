import { noteModel } from '@repo/notes/models/note';
import type { RenameNoteInput } from '@repo/notes/types/note';
import { defineCommand } from '@repo/sync/commands/define';

/** Renames a note. The new title shows at once; the server confirms it later. */
export const renameNote = defineCommand<RenameNoteInput>({
  name: 'notes/rename',
  waits: 'local',
  input: { id: 'string', title: 'string', at: 'string' },
  apply: (draft, input) => {
    const note = draft.get(noteModel, input.id);
    if (note) {
      draft.put(noteModel, { ...note, title: input.title, updatedAt: input.at });
    }
  },
});
