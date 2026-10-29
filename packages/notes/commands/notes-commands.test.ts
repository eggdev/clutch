import { expect, test } from 'bun:test';

import { createSpaceServer } from '@repo/access/commands/create-space.server';
import { testActor } from '@repo/identity/testing/actor';
import { createNote } from '@repo/notes/commands/create-note';
import { createNoteServer } from '@repo/notes/commands/create-note.server';
import { renameNote } from '@repo/notes/commands/rename-note';
import { renameNoteServer } from '@repo/notes/commands/rename-note.server';
import { noteModel } from '@repo/notes/models/note';
import { Notes } from '@repo/notes/service/notes';
import { NotesTest } from '@repo/notes/testing/notes';
import { createPool } from '@repo/sync/runtime/pool';
import { Database } from '@repo/sync/service/database';
import type { Outbox } from '@repo/sync/service/jobs';
import type { SyncGroups } from '@repo/sync/service/sync-groups';
import { Effect } from 'effect';

const at = '2026-10-28T12:00:00.000Z';

test('the local changes create and rename a note in the pool at once', () => {
  const pool = createPool([createNote, renameNote]);
  pool.run(createNote, { id: 'n1', spaceId: 'general', title: 'Draft', at });
  pool.run(renameNote, { id: 'n1', title: 'Final', at });
  expect(pool.get(noteModel, 'n1')?.title).toBe('Final');
});

function server<A, E>(program: Effect.Effect<A, E, Database | Notes | Outbox | SyncGroups>) {
  return Effect.runPromise(program.pipe(Effect.provide(NotesTest())));
}

test('the server changes write the owner record and return the change for clients', async () => {
  const [created, renamed, stored] = await server(
    Effect.gen(function* () {
      const db = yield* Database;
      const actor = testActor;
      const first = yield* createNoteServer.run(
        { id: 'n1', spaceId: 'general', title: 'Draft', at },
        { db, actor },
      );
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
      const actor = testActor;
      const missing = yield* renameNoteServer
        .run({ id: 'none', title: 'x', at }, { db, actor })
        .pipe(Effect.flip);
      const long = yield* createNoteServer
        .run({ id: 'n2', spaceId: 'general', title: 'x'.repeat(201), at }, { db, actor })
        .pipe(Effect.flip);
      return [missing, long];
    }),
  );
  expect(reasons).toMatchObject([
    { _tag: 'CommandRejected', reason: 'This record does not exist.' },
    { _tag: 'CommandRejected', reason: 'The input of notes/create is not valid.' },
  ]);
});

test('only a member of a space can write a note there, and the note is in its space group', async () => {
  const [outsider, member] = await server(
    Effect.gen(function* () {
      const db = yield* Database;
      yield* createSpaceServer.run({ id: 'design', name: 'Design', at }, { db, actor: testActor });
      const other = { ...testActor, userId: 'user-other' };
      const refused = yield* createNoteServer
        .run({ id: 'n3', spaceId: 'design', title: 'Secret', at }, { db, actor: other })
        .pipe(Effect.flip);
      const written = yield* createNoteServer.run(
        { id: 'n4', spaceId: 'design', title: 'Plan', at },
        { db, actor: testActor },
      );
      return [refused, written];
    }),
  );
  expect(outsider).toMatchObject({ reason: 'You may not change records here.' });
  expect(Array.isArray(member) && member[0]?.groups).toEqual(['space:design']);
});
