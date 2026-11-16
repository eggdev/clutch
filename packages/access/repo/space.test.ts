import { expect, test } from 'bun:test';

import * as membership from '@repo/access/repo/membership';
import * as space from '@repo/access/repo/space';
import { AccessTest } from '@repo/access/testing/access';
import { Database } from '@repo/sync/service/database';
import { skipWrites } from '@repo/sync/testing/skip-writes';
import { Effect } from 'effect';

test('a space record becomes a row and comes back the same', () => {
  const record = {
    id: 'space-1',
    name: 'Design',
    createdAt: '2026-10-28T12:00:00.000Z',
    updatedAt: '2026-10-28T12:30:00.000Z',
  };
  expect(space.toRecord(space.toRow(record, 'org-a'))).toEqual(record);
});

test('a membership record becomes a row and comes back the same', () => {
  const record = {
    id: 'space-1:user-a',
    spaceId: 'space-1',
    userId: 'user-a',
    joinedAt: '2026-10-28T12:00:00.000Z',
  };
  expect(membership.toRecord(membership.toRow(record, 'org-a'))).toEqual(record);
});

test('a space is in its organization group, and a membership only in its user group', () => {
  const row = space.toRow(
    {
      id: 's',
      name: 'S',
      createdAt: '2026-10-28T12:00:00.000Z',
      updatedAt: '2026-10-28T12:00:00.000Z',
    },
    'org-a',
  );
  expect(space.spaceChange(row).groups).toEqual(['org:org-a']);
  const member = membership.toRow(
    { id: 's:u', spaceId: 's', userId: 'u', joinedAt: '2026-10-28T12:00:00.000Z' },
    'org-a',
  );
  expect(membership.joinedChange(member).groups).toEqual(['user:u']);
  expect(membership.leftChange(member).action).toBe('delete');
});

const design = space.toRow(
  {
    id: 'design',
    name: 'Design',
    createdAt: '2026-10-28T12:00:00.000Z',
    updatedAt: '2026-10-28T12:00:00.000Z',
  },
  'org-a',
);
const joined = membership.toRow(
  { id: 'design:u', spaceId: 'design', userId: 'u', joinedAt: '2026-10-28T12:00:00.000Z' },
  'org-a',
);

test('a new space and a new membership return the rows that the database holds', async () => {
  const result = await Effect.runPromise(
    Effect.gen(function* () {
      const db = yield* Database;
      const written = [
        yield* space.insertSpace(db, design),
        yield* membership.insertMembership(db, joined),
      ];
      const stored = [
        yield* space.findSpace(db, 'org-a', 'design'),
        yield* membership.findMembership(db, 'org-a', 'design', 'u'),
      ];
      return { written, stored };
    }).pipe(Effect.provide(AccessTest())),
  );
  expect(result.written).toEqual(result.stored);
  expect(result.written).toEqual([design, joined]);
});

test('a space or a membership that the database does not store fails, and never returns its input', async () => {
  const failures = await Effect.runPromise(
    Effect.gen(function* () {
      const db = yield* Database;
      yield* skipWrites(db, 'spaces');
      yield* skipWrites(db, 'space_memberships');
      return [
        yield* space.insertSpace(db, design).pipe(Effect.flip),
        yield* membership.insertMembership(db, joined).pipe(Effect.flip),
      ];
    }).pipe(Effect.provide(AccessTest())),
  );
  expect(failures).toMatchObject([
    { _tag: 'RowNotStored', table: 'spaces' },
    { _tag: 'RowNotStored', table: 'space_memberships' },
  ]);
});
