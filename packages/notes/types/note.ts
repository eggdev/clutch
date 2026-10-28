import { maxTitleLength } from '@repo/notes/models/note';
import { Schema } from 'effect';

/** A note, as the server sends it and the object pool holds it. Dates are ISO strings. */
export const Note = Schema.Struct({
  id: Schema.String,
  spaceId: Schema.String,
  title: Schema.String,
  createdAt: Schema.String,
  updatedAt: Schema.String,
});
export type Note = typeof Note.Type;

const Title = Schema.String.pipe(Schema.check(Schema.isMaxLength(maxTitleLength)));

export const CreateNoteInput = Schema.Struct({
  id: Schema.String,
  spaceId: Schema.String,
  title: Title,
  at: Schema.String,
});
export type CreateNoteInput = typeof CreateNoteInput.Type;

export const RenameNoteInput = Schema.Struct({
  id: Schema.String,
  title: Title,
  at: Schema.String,
});
export type RenameNoteInput = typeof RenameNoteInput.Type;
