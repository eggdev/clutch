import { canUseSpace } from '@repo/access/service/access';
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
export const renameNoteServer = defineServerChange(
  renameNote,
  RenameNoteInput,
  (input, { db, actor }) =>
    Effect.gen(function* () {
      const note = yield* findNote(db, actor.organizationId, input.id);
      if (!note) {
        return yield* new CommandRejected({ reason: 'This note does not exist.' });
      }
      if (!(yield* canUseSpace(db, actor, note.spaceId))) {
        return yield* new CommandRejected({ reason: 'You are not a member of this space.' });
      }
      const now = new Date(yield* Clock.currentTimeMillis);
      return [toChange(yield* updateTitle(db, note, input.title, now))];
    }),
);
