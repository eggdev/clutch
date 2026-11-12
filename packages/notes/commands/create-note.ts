import { createNote, noteRecord } from '@repo/notes/contract/notes';
import { localChange } from '@repo/sync/contract/command';

/** The local change of `notes/create`: the note shows in its space at once. */
export const createNoteLocal = localChange(createNote, (draft, input) =>
  draft.put(noteRecord, {
    id: input.id,
    spaceId: input.spaceId,
    title: input.title,
    createdAt: input.at,
    updatedAt: input.at,
  }),
);
