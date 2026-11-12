import { countNotes } from '@repo/notes/jobs/count-notes';
import { insertNote, toChange } from '@repo/notes/repo/notes';
import type { DrizzleDatabase } from '@repo/sync/service/database';
import { Outbox } from '@repo/sync/service/jobs';
import { Clock, Effect } from 'effect';

/**
 * Writes one note in the transaction it is given, and asks for the job that
 * counts the notes of its space. The `notes/create` command and the import
 * webhook both write a note here, so a rule of the write holds for both. The
 * server clock sets the dates. The caller checks who may write: a command
 * through its access rule, and a webhook through its signature.
 */
export function addNote(
  db: DrizzleDatabase,
  note: {
    readonly id: string;
    readonly organizationId: string;
    readonly spaceId: string;
    readonly title: string;
  },
) {
  return Effect.gen(function* () {
    const now = new Date(yield* Clock.currentTimeMillis);
    const row = yield* insertNote(db, { ...note, createdAt: now, updatedAt: now });
    // The count job runs after this transaction commits, so the screen
    // never counts the notes of a space itself.
    const outbox = yield* Outbox;
    yield* outbox.enqueue(
      db,
      countNotes,
      { spaceId: row.spaceId },
      { id: `notes/count:${row.id}`, organizationId: row.organizationId },
    );
    return toChange(row);
  });
}
