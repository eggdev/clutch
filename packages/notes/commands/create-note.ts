import { noteModel } from '@repo/notes/models/note';
import type { CreateNoteInput } from '@repo/notes/types/note';
import { defineCommand } from '@repo/sync/commands/define';

/** Creates a note in a space. The note shows at once; the server confirms it later. */
export const createNote = defineCommand<CreateNoteInput>({
  name: 'notes/create',
  waits: 'local',
  apply: (draft, input) =>
    draft.put(noteModel, {
      id: input.id,
      spaceId: input.spaceId,
      title: input.title,
      createdAt: input.at,
      updatedAt: input.at,
    }),
});
