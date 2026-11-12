import { noteRecord } from '@repo/notes/contract/notes';
import type { Note } from '@repo/notes/contract/notes';
import { useRecord, useRecordIds } from '@repo/sync/ui/sync-provider';

/**
 * The IDs of the notes of one space, newest first. The list derives from the
 * records; nothing stores it. A rename does not change it.
 */
export function useNoteIds(spaceId: string): ReadonlyArray<string> {
  return useRecordIds(
    noteRecord,
    { by: 'createdAt', direction: 'desc' },
    { field: 'spaceId', equals: spaceId },
  );
}

/** One note. Only the component that shows it re-renders when it changes. */
export function useNote(id: string): Note | undefined {
  return useRecord(noteRecord, id);
}
