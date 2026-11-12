import { spaceGroup } from '@repo/access/contract/access';
import { createNote } from '@repo/notes/contract/notes';
import { findNote, toChange } from '@repo/notes/repo/notes';
import { addNote } from '@repo/notes/service/add-note';
import { serverChange } from '@repo/sync/commands/server-change.server';
import { Effect } from 'effect';

/**
 * Writes the note in a space of the actor's organization. Only a member of the
 * space may write there. `addNote` makes the write, as it does for the import
 * webhook, so both follow one rule.
 */
export const createNoteServer = serverChange(createNote, {
  group: (input) => Effect.succeed(spaceGroup.of(input.spaceId)),
  run: (input, { db, actor }) =>
    Effect.gen(function* () {
      const existing = yield* findNote(db, actor.organizationId, input.id);
      if (existing) {
        return [toChange(existing)];
      }
      const change = yield* addNote(db, {
        id: input.id,
        organizationId: actor.organizationId,
        spaceId: input.spaceId,
        title: input.title,
      });
      return [change];
    }),
});
