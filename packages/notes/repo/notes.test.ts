import { expect, test } from 'bun:test';

import { findNote, insertNote, toRecord, toRow } from '@repo/notes/repo/notes';
import { NotesDatabaseTest } from '@repo/notes/testing/notes';
import { Database } from '@repo/sync/service/database';
import { Effect } from 'effect';

const note = {
  id: 'n1',
  spaceId: 'general',
  title: 'First',
  createdAt: '2026-10-28T12:00:00.000Z',
  updatedAt: '2026-10-28T12:30:00.000Z',
};

test('a record becomes a row and comes back the same', () => {
  expect(toRecord(toRow(note, 'org-a'))).toEqual(note);
});

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
