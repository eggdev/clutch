import { spaceGroup } from '@repo/access/contract/access';
import { renameNote } from '@repo/notes/contract/notes';
import { findNote, toChange, updateTitle } from '@repo/notes/repo/notes';
import { serverChange } from '@repo/sync/commands/server-change.server';
import { Clock, Effect } from 'effect';

/**
 * Renames a note of the actor's organization, in a space the actor is a member
 * of. A note of another organization does not exist here.
 */
export const renameNoteServer = serverChange(renameNote, {
  group: (input, { db, actor }) =>
    findNote(db, actor.organizationId, input.id).pipe(
      Effect.map((note) => (note ? spaceGroup.of(note.spaceId) : null)),
    ),
  run: (input, { db, actor, refuse }) =>
    Effect.gen(function* () {
      const note = yield* findNote(db, actor.organizationId, input.id);
      if (!note) {
        return yield* refuse('not-found', 'This note does not exist.');
      }
      const now = new Date(yield* Clock.currentTimeMillis);
      return [toChange(yield* updateTitle(db, note, input.title, now))];
    }),
});
