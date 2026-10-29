import { spaceGroup } from '@repo/access/models/space';
import type { Note } from '@repo/notes/types/note';
import { defineLoad, defineModel } from '@repo/sync/models/define';

/**
 * Notes in the object pool. A note is in the group of its space, so only
 * members of the space get it. A list reads note IDs with `useRecordIds`,
 * and each row reads its note with `useRecord`.
 */
export const noteModel = defineModel<Note>('Note', {
  fields: {
    id: 'string',
    spaceId: 'string',
    title: 'string',
    createdAt: 'string',
    updatedAt: 'string',
  },
  groupsOf: (note) => [spaceGroup(note.spaceId)],
});

/** The load function of notes: a gate asks for the notes of one space. */
export const notesOf = defineLoad(noteModel, (spaceId: string) => spaceGroup(spaceId));

/**
 * The longest title. UI code needs it as a value, so it lives here in plain
 * TypeScript, and the schema in `types/` reads it from here.
 */
export const maxTitleLength = 200;
