import { Schema } from 'effect';

/**
 * The number of notes in one space. A job counts them on the server after
 * each new note, so the screen never counts a large list. The ID is the
 * space ID.
 */
export const SpaceNoteCount = Schema.Struct({
  id: Schema.String,
  spaceId: Schema.String,
  noteCount: Schema.Number,
  updatedAt: Schema.String,
});
export type SpaceNoteCount = typeof SpaceNoteCount.Type;

export const CountNotesPayload = Schema.Struct({ spaceId: Schema.String });
