import { expect, test } from 'bun:test';

import { CurrentActor } from '@repo/identity/service/current-actor';
import { CurrentActorTest } from '@repo/identity/testing/actor';
import { createNote } from '@repo/notes/commands/create-note';
import { createNoteServer } from '@repo/notes/commands/create-note.server';
import { renameNote } from '@repo/notes/commands/rename-note';
import { renameNoteServer } from '@repo/notes/commands/rename-note.server';
import { noteModel } from '@repo/notes/models/note';
import { Notes } from '@repo/notes/service/notes';
import { NotesTest } from '@repo/notes/testing/notes';
import { createPool } from '@repo/sync/runtime/pool';
import { Database } from '@repo/sync/service/database';
import { Effect, Layer } from 'effect';

const at = '2026-10-28T12:00:00.000Z';

test('the local changes create and rename a note in the pool at once', () => {
  const pool = createPool([createNote, renameNote]);
  pool.run(createNote, { id: 'n1', title: 'Draft', at });
  pool.run(renameNote, { id: 'n1', title: 'Final', at });
  expect(pool.get(noteModel, 'n1')?.title).toBe('Final');
});

const layers = Layer.mergeAll(NotesTest(), CurrentActorTest());

function server<A, E>(program: Effect.Effect<A, E, Database | Notes | CurrentActor>) {
  return Effect.runPromise(program.pipe(Effect.provide(layers)));
}

test('the server changes write the owner record and return the change for clients', async () => {
  const [created, renamed, stored] = await server(
    Effect.gen(function* () {
      const db = yield* Database;
      const actor = yield* CurrentActor;
      const first = yield* createNoteServer.run({ id: 'n1', title: 'Draft', at }, { db, actor });
      const second = yield* renameNoteServer.run({ id: 'n1', title: 'Final', at }, { db, actor });
      const notes = yield* Notes;
      return [first, second, yield* notes.byId(actor.organizationId, 'n1')];
    }),
  );
  expect(created.map((change) => change.id)).toEqual(['n1']);
  expect(renamed[0]?.data).toMatchObject({ title: 'Final' });
  expect(stored?.title).toBe('Final');
});

test('the server rejects a rename of a missing note and a title that is too long', async () => {
  const reasons = await server(
    Effect.gen(function* () {
      const db = yield* Database;
      const actor = yield* CurrentActor;
      const missing = yield* renameNoteServer
        .run({ id: 'none', title: 'x', at }, { db, actor })
        .pipe(Effect.flip);
      const long = yield* createNoteServer
        .run({ id: 'n2', title: 'x'.repeat(201), at }, { db, actor })
        .pipe(Effect.flip);
      return [missing, long];
    }),
  );
  expect(reasons).toMatchObject([
    { _tag: 'CommandRejected', reason: 'This note does not exist.' },
    { _tag: 'CommandRejected', reason: 'The input of notes/create is not valid.' },
  ]);
});
