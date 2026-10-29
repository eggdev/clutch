import { maxTitleLength } from '@repo/notes/models/note';
import { Schema } from 'effect';

/**
 * One note that an outside system sends to the import webhook. `eventId` is
 * the sender's ID for this delivery. A repeated delivery has the same ID.
 */
export const ImportNoteEvent = Schema.Struct({
  eventId: Schema.String,
  organizationId: Schema.String,
  title: Schema.String.pipe(Schema.check(Schema.isMaxLength(maxTitleLength))),
});
export type ImportNoteEvent = typeof ImportNoteEvent.Type;
