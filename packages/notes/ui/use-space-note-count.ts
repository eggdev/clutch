import { spaceNoteCountRecord } from '@repo/notes/contract/notes';
import { useRecord } from '@repo/sync/ui/sync-provider';

/**
 * The note count of one space, as the server counted it. It is `undefined`
 * until the first count arrives. The screen never counts the notes itself.
 */
export function useSpaceNoteCount(spaceId: string): number | undefined {
  return useRecord(spaceNoteCountRecord, spaceId)?.noteCount;
}
