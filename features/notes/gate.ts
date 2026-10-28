import { generalSpaceId } from '@repo/access/models/space';
import { notesOf } from '@repo/notes/models/note';
import type { useLoad } from '@repo/sync/ui/sync-provider';

/** What the gate needs from the screen that opens it. */
export type OpenNotes = {
  readonly navigate: (href: string) => void;
  readonly load: ReturnType<typeof useLoad>;
};

/**
 * The one way into the notes feature. It loads the notes of the space before
 * the navigation, so the screen renders with them. A space the client
 * loaded before opens at once, offline too. See
 * docs/principles/one-gate-per-feature.md.
 */
export async function openNotes(open: OpenNotes, spaceId: string = generalSpaceId) {
  await open.load(notesOf, spaceId);
  open.navigate(`/notes?space=${encodeURIComponent(spaceId)}`);
}
