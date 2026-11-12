import { generalSpaceId } from '@repo/access/contract/access';
import { notesOf } from '@repo/notes/contract/notes';
import type { useLoad } from '@repo/sync/ui/sync-provider';

/**
 * Where the gate navigates: the notes route, with the space in its query. The
 * router of the app types its routes in the generated `app/routes.d.ts`. The
 * app passes this target to `router.push`, so an app with no `/notes` route
 * does not compile.
 */
export type NotesHref = `/notes?space=${string}`;

/** What the gate needs from the screen that opens it. */
export type OpenNotes = {
  readonly navigate: (href: NotesHref) => void;
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
