import { expect, test } from 'bun:test';

import { findNote, insertNote, toRecord, toRow, updateTitle } from '@repo/notes/repo/notes';
import { NotesDatabaseTest } from '@repo/notes/testing/notes';
import { Database } from '@repo/sync/service/database';
import { skipWrites } from '@repo/sync/testing/skip-writes';
import { Effect } from 'effect';

const note = {
  id: 'n1',
  spaceId: 'general',
  title: 'First',
  createdAt: '2026-10-28T12:00:00.000Z',
  updatedAt: '2026-10-28T12:30:00.000Z',
};

test('a row written to Postgres reads back as the same record, only in its organization', async () => {
  const [mine, theirs] = await Effect.runPromise(
    Effect.gen(function* () {
      const db = yield* Database;
      yield* insertNote(db, toRow(note, 'org-a'));
      return [yield* findNote(db, 'org-a', 'n1'), yield* findNote(db, 'org-b', 'n1')];
    }).pipe(Effect.provide(NotesDatabaseTest())),
  );
  expect(mine && toRecord(mine)).toEqual(note);
  expect(theirs).toBeUndefined();
});

test('a rename returns the row that the database holds', async () => {
  const at = new Date('2026-10-29T08:00:00.000Z');
  const [renamed, stored] = await Effect.runPromise(
    Effect.gen(function* () {
      const db = yield* Database;
      const row = yield* insertNote(db, toRow(note, 'org-a'));
      return [yield* updateTitle(db, row, 'Second', at), yield* findNote(db, 'org-a', 'n1')];
    }).pipe(Effect.provide(NotesDatabaseTest())),
  );
  expect(renamed).toEqual(stored);
  expect(renamed && toRecord(renamed)).toMatchObject({
    title: 'Second',
    updatedAt: at.toISOString(),
  });
});

test('a write that stores no note fails, and never returns its input as stored', async () => {
  const failures = await Effect.runPromise(
    Effect.gen(function* () {
      const db = yield* Database;
      const missing = yield* updateTitle(db, toRow(note, 'org-a'), 'Second', new Date()).pipe(
        Effect.flip,
      );
      yield* skipWrites(db, 'notes');
      const skipped = yield* insertNote(db, toRow(note, 'org-a')).pipe(Effect.flip);
      return [missing, skipped];
    }).pipe(Effect.provide(NotesDatabaseTest())),
  );
  expect(failures).toMatchObject([
    { _tag: 'RowNotStored', table: 'notes' },
    { _tag: 'RowNotStored', table: 'notes' },
  ]);
});
