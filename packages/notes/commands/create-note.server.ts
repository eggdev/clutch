import { spaceGroup } from '@repo/access/models/space';
import { createNote } from '@repo/notes/commands/create-note';
import { countNotes } from '@repo/notes/jobs/count-notes';
import { findNote, insertNote, toChange } from '@repo/notes/repo/notes';
import { CreateNoteInput } from '@repo/notes/types/note';
import { defineServerChange } from '@repo/sync/commands/define.server';
import { Outbox } from '@repo/sync/service/jobs';
import { Clock, Effect } from 'effect';

/**
 * Writes the note in a space of the actor's organization. Only a member of the
 * space may write there. The server clock sets its dates. It asks for the
 * `count-notes` job, which updates the count of the space after the commit.
 */
export const createNoteServer = defineServerChange(createNote, {
  input: CreateNoteInput,
  access: { group: (input) => Effect.succeed(spaceGroup(input.spaceId)) },
  run: (input, { db, actor }) =>
    Effect.gen(function* () {
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
      // The count job runs after this transaction commits, so the screen
      // never counts the notes of a space itself.
      const outbox = yield* Outbox;
      yield* outbox.enqueue(
        db,
        countNotes,
        { spaceId: row.spaceId },
        { id: `notes/count:${row.id}`, organizationId: row.organizationId },
      );
      return [toChange(row)];
    }),
});
