import type { Note } from '@repo/notes/types/note';
import { defineModel } from '@repo/sync/models/define';

/**
 * Notes in the object pool. A list reads their IDs with `useRecordIds(noteModel)`,
 * and each row reads its note with `useRecord(noteModel, id)`.
 */
export const noteModel = defineModel<Note>('Note');

/**
 * The longest title. UI code needs it as a value, so it lives here in plain
 * TypeScript, and the schema in `types/` reads it from here.
 */
export const maxTitleLength = 200;
