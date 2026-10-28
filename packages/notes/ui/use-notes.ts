import { noteModel } from '@repo/notes/models/note';
import type { Note } from '@repo/notes/types/note';
import { useRecords } from '@repo/sync/ui/sync-provider';

/** The organization's notes, newest first. The list derives from the records; nothing stores it. */
export function useNotes(): ReadonlyArray<Note> {
  return useRecords(noteModel).toSorted((a, b) => b.createdAt.localeCompare(a.createdAt));
}
