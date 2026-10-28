import { expect, test } from 'bun:test';

import * as membership from '@repo/access/repo/membership';
import * as space from '@repo/access/repo/space';

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
