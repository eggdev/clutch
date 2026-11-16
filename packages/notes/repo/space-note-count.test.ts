import { expect, test } from 'bun:test';

import { saveCount } from '@repo/notes/repo/space-note-count';
import { NotesDatabaseTest } from '@repo/notes/testing/notes';
import { Database } from '@repo/sync/service/database';
import { skipWrites } from '@repo/sync/testing/skip-writes';
import { Effect } from 'effect';

const count = (noteCount: number, at: string) => ({
  organizationId: 'org-a',
  spaceId: 'general',
  noteCount,
  updatedAt: new Date(at),
});

test('a count saved again for the same space returns the row that the database holds', async () => {
  const [first, second] = await Effect.runPromise(
    Effect.gen(function* () {
      const db = yield* Database;
      return [
        yield* saveCount(db, count(1, '2026-10-28T12:00:00.000Z')),
        yield* saveCount(db, count(2, '2026-10-28T12:01:00.000Z')),
      ];
    }).pipe(Effect.provide(NotesDatabaseTest())),
  );
  expect(first).toEqual(count(1, '2026-10-28T12:00:00.000Z'));
  expect(second).toEqual(count(2, '2026-10-28T12:01:00.000Z'));
});

test('a count that the database does not store fails, and never returns its input as stored', async () => {
  const failure = await Effect.runPromise(
    Effect.gen(function* () {
      const db = yield* Database;
      yield* skipWrites(db, 'space_note_counts');
      return yield* saveCount(db, count(1, '2026-10-28T12:00:00.000Z')).pipe(Effect.flip);
    }).pipe(Effect.provide(NotesDatabaseTest())),
  );
  expect(failure).toMatchObject({ _tag: 'RowNotStored', table: 'space_note_counts' });
});
