import { countNotesIn, saveCount, toCountChange } from '@repo/notes/repo/space-note-count';
import { CountNotesPayload } from '@repo/notes/types/space-note-count';
import { defineJob } from '@repo/sync/service/jobs';
import { Clock, Effect } from 'effect';

/**
 * Counts the notes of one space and commits the count, so each member of the
 * space gets it as a delta. A new note asks for this job in its own
 * transaction. Counting again gives the same answer, so a retry is safe.
 */
export const countNotes = defineJob({
  name: 'notes/count-notes',
  payload: CountNotesPayload,
  run: ({ spaceId }, { organizationId, commit }) =>
    Effect.gen(function* () {
      if (organizationId === null) {
        return;
      }
      yield* commit((db) =>
        Effect.gen(function* () {
          const noteCount = yield* countNotesIn(db, organizationId, spaceId);
          const now = new Date(yield* Clock.currentTimeMillis);
          const row = yield* saveCount(db, { organizationId, spaceId, noteCount, updatedAt: now });
          return [toCountChange(row)];
        }),
      );
    }),
});
