import { spaceGroup } from '@repo/access/models/space';
import { renameNote } from '@repo/notes/commands/rename-note';
import { findNote, toChange, updateTitle } from '@repo/notes/repo/notes';
import { RenameNoteInput } from '@repo/notes/types/note';
import { defineServerChange } from '@repo/sync/commands/define.server';
import { CommandRejected } from '@repo/sync/types/command-rejected';
import { Clock, Effect } from 'effect';

/**
 * Renames a note of the actor's organization, in a space the actor is a member
 * of. A note of another organization does not exist here.
 */
export const renameNoteServer = defineServerChange(renameNote, {
  input: RenameNoteInput,
  access: {
    group: (input, { db, actor }) =>
      findNote(db, actor.organizationId, input.id).pipe(
        Effect.map((note) => (note ? spaceGroup(note.spaceId) : null)),
      ),
  },
  run: (input, { db, actor }) =>
    Effect.gen(function* () {
      const note = yield* findNote(db, actor.organizationId, input.id);
      if (!note) {
        return yield* new CommandRejected({ reason: 'This note does not exist.' });
      }
      const now = new Date(yield* Clock.currentTimeMillis);
      return [toChange(yield* updateTitle(db, note, input.title, now))];
    }),
});
