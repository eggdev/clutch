import { expect, test } from 'bun:test';

import { createSpaceServer } from '@repo/access/commands/create-space.server';
import { joinSpaceServer } from '@repo/access/commands/join-space.server';
import { leaveSpaceServer } from '@repo/access/commands/leave-space.server';
import { Access } from '@repo/access/service/access';
import { AccessTest } from '@repo/access/testing/access';
import { Database } from '@repo/sync/service/database';
import { Effect } from 'effect';

const at = '2026-10-28T12:00:00.000Z';
const owner = { userId: 'user-a', organizationId: 'org-a' };
const other = { userId: 'user-b', organizationId: 'org-a' };

test('every actor loads its organization and user groups at once, and each of its spaces on request', async () => {
  const result = await Effect.runPromise(
    Effect.gen(function* () {
      const db = yield* Database;
      const access = yield* Access;
      yield* createSpaceServer.run({ id: 'design', name: 'Design', at }, { db, actor: owner });
      const before = yield* access.groupsFor(other);
      yield* joinSpaceServer.run({ spaceId: 'design', at }, { db, actor: other });
      const joined = yield* access.groupsFor(other);
      yield* leaveSpaceServer.run({ spaceId: 'design' }, { db, actor: other });
      const left = yield* access.groupsFor(other);
      return { owner: yield* access.groupsFor(owner), before, joined, left };
    }).pipe(Effect.provide(AccessTest())),
  );
  expect(result.owner).toEqual({
    eager: ['org:org-a', 'user:user-a'],
    lazy: ['space:general', 'space:design'],
  });
  expect(result.before.lazy).toEqual(['space:general']);
  expect(result.joined.lazy).toEqual(['space:general', 'space:design']);
  expect(result.left.lazy).toEqual(['space:general']);
});

test('no one can leave the general space, and only a member can leave a space', async () => {
  const reasons = await Effect.runPromise(
    Effect.gen(function* () {
      const db = yield* Database;
      const general = yield* leaveSpaceServer
        .run({ spaceId: 'general' }, { db, actor: owner })
        .pipe(Effect.flip);
      const outsider = yield* leaveSpaceServer
        .run({ spaceId: 'design' }, { db, actor: other })
        .pipe(Effect.flip);
      return [general, outsider];
    }).pipe(Effect.provide(AccessTest())),
  );
  expect(reasons).toMatchObject([
    { reason: 'No one can leave the general space.' },
    { reason: 'You are not a member of this space.' },
  ]);
});
