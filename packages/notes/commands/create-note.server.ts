import { canUseSpace } from '@repo/access/service/access';
import { createNote } from '@repo/notes/commands/create-note';
import { findNote, insertNote, toChange } from '@repo/notes/repo/notes';
import { CreateNoteInput } from '@repo/notes/types/note';
import { defineServerChange } from '@repo/sync/commands/define.server';
import { CommandRejected } from '@repo/sync/types/command-rejected';
import { Clock, Effect } from 'effect';

/**
 * Writes the note in a space of the actor's organization. Only a member of the
 * space may write there. The server clock sets its dates.
 */
export const createNoteServer = defineServerChange(
  createNote,
  CreateNoteInput,
  (input, { db, actor }) =>
    Effect.gen(function* () {
      if (!(yield* canUseSpace(db, actor, input.spaceId))) {
        return yield* new CommandRejected({ reason: 'You are not a member of this space.' });
      }
      const existing = yield* findNote(db, actor.organizationId, input.id);
      if (existing) {
        return [toChange(existing)];
      }
      const now = new Date(yield* Clock.currentTimeMillis);
      const row = yield* insertNote(db, {
        id: input.id,
        organizationId: actor.organizationId,
        spaceId: input.spaceId,
        title: input.title,
        createdAt: now,
        updatedAt: now,
      });
      return [toChange(row)];
    }),
);
