import { noteModel } from '@repo/notes/models/note';
import type { Note } from '@repo/notes/types/note';
import { useRecord, useRecordIds } from '@repo/sync/ui/sync-provider';

/**
 * The IDs of the organization's notes, newest first. The list derives from the
 * records; nothing stores it. A rename does not change it.
 */
export function useNoteIds(): ReadonlyArray<string> {
  return useRecordIds(noteModel, { by: 'createdAt', direction: 'desc' });
}

/** One note. Only the component that shows it re-renders when it changes. */
export function useNote(id: string): Note | undefined {
  return useRecord(noteModel, id);
}
