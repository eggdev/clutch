import { expect, test } from 'bun:test';

import { createSpaceServer } from '@repo/access/commands/create-space.server';
import { testActor } from '@repo/identity/testing/actor';
import { createNoteServer } from '@repo/notes/commands/create-note.server';
import { renameNoteServer } from '@repo/notes/commands/rename-note.server';
import { createNote, noteRecord, renameNote } from '@repo/notes/contract/notes';
import { findNote } from '@repo/notes/repo/notes';
import { notesClient } from '@repo/notes/runtime/client';
import { NotesTest } from '@repo/notes/testing/notes';
import { createPool } from '@repo/sync/runtime/pool';
import { Database } from '@repo/sync/service/database';
import type { Outbox } from '@repo/sync/service/jobs';
import type { SyncGroups } from '@repo/sync/service/sync-groups';
import { testStamps } from '@repo/sync/testing/pool-state';
import { Effect } from 'effect';

const at = '2026-10-28T12:00:00.000Z';

test('the local changes create and rename a note in the pool at once', () => {
  const pool = createPool(notesClient.localChanges, notesClient.contract);
  pool.run(createNote, { id: 'n1', spaceId: 'general', title: 'Draft', at });
  pool.run(renameNote, { id: 'n1', title: 'Final', at });
  expect(pool.get(noteRecord, 'n1')?.title).toBe('Final');
});

test('a screen gives no ID and no time: the pool stamps the new note', () => {
  const pool = createPool(notesClient.localChanges, notesClient.contract, {
    stamps: testStamps(at),
  });
  pool.run(createNote, { spaceId: 'general', title: 'Draft' });
  // The transaction took `id-1`, so the note got `id-2`.
  expect(pool.get(noteRecord, 'id-2')).toEqual({
    id: 'id-2',
    spaceId: 'general',
    title: 'Draft',
    createdAt: at,
    updatedAt: at,
  });
});

function server<A, E>(program: Effect.Effect<A, E, Database | Outbox | SyncGroups>) {
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
      return [first, second, yield* findNote(db, actor.organizationId, 'n1')];
    }),
  );
  expect(created.map((change) => change.id)).toEqual(['n1']);
  expect(renamed[0]?.data).toMatchObject({ title: 'Final' });
  expect(stored?.title).toBe('Final');
});

test('a repeated create returns the stored note, and keeps its first title', async () => {
  const [first, repeat] = await server(
    Effect.gen(function* () {
      const db = yield* Database;
      const actor = testActor;
      const run = (title: string) =>
        createNoteServer.run({ id: 'n1', spaceId: 'general', title, at }, { db, actor });
      return [yield* run('Draft'), yield* run('Other')];
    }),
  );
  expect(repeat).toEqual(first);
  expect(repeat[0]?.data).toMatchObject({ title: 'Draft' });
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
    { _tag: 'CommandRejected', code: 'not-found', reason: 'This record does not exist.' },
    {
      _tag: 'CommandRejected',
      code: 'invalid-input',
      reason: 'The input of notes/create is not valid.',
    },
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
  expect(outsider).toMatchObject({ code: 'forbidden', reason: 'You may not change records here.' });
  expect(Array.isArray(member) && member[0]?.groups).toEqual(['space:design']);
});
