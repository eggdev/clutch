import { findNote, toRecord } from '@repo/notes/repo/notes';
import { notes } from '@repo/notes/repo/schema';
import type { Note } from '@repo/notes/types/note';
import { Database } from '@repo/sync/service/database';
import { desc, eq } from 'drizzle-orm';
import { Context, Effect, Layer } from 'effect';

/**
 * Reads notes on the server, outside a transaction, for code such as an MCP
 * tool. Writes go through commands, so every client gets a delta.
 */
export class Notes extends Context.Service<
  Notes,
  {
    readonly byId: (organizationId: string, id: string) => Effect.Effect<Note | undefined, unknown>;
    readonly list: (organizationId: string) => Effect.Effect<ReadonlyArray<Note>, unknown>;
  }
>()('notes/Notes') {}

export const NotesLive = Layer.effect(Notes)(
  Effect.gen(function* () {
    const db = yield* Database;
    return {
      byId: (organizationId, id) =>
        findNote(db, organizationId, id).pipe(
          Effect.map((row) => (row ? toRecord(row) : undefined)),
        ),
      list: (organizationId) =>
        db
          .select()
          .from(notes)
          .where(eq(notes.organizationId, organizationId))
          .orderBy(desc(notes.createdAt))
          .pipe(Effect.map((rows) => rows.map(toRecord))),
    };
  }),
);
