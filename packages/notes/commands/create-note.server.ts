import { createNote } from '@repo/notes/commands/create-note';
import { findNote, insertNote, toChange } from '@repo/notes/repo/notes';
import { CreateNoteInput } from '@repo/notes/types/note';
import { defineServerChange } from '@repo/sync/commands/define.server';
import { Clock, Effect } from 'effect';

/** Writes the note for the actor's organization. The server clock sets its dates. */
export const createNoteServer = defineServerChange(
  createNote,
  CreateNoteInput,
  (input, { db, actor }) =>
    Effect.gen(function* () {
      const existing = yield* findNote(db, actor.organizationId, input.id);
      if (existing) {
        return [toChange(existing)];
      }
      const now = new Date(yield* Clock.currentTimeMillis);
      const row = yield* insertNote(db, {
        id: input.id,
        organizationId: actor.organizationId,
        title: input.title,
        createdAt: now,
        updatedAt: now,
      });
      return [toChange(row)];
    }),
);
