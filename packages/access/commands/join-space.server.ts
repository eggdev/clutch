import { generalSpaceId, joinSpace } from '@repo/access/contract/access';
import { findMembership, insertMembership, joinedChange } from '@repo/access/repo/membership';
import { findSpace } from '@repo/access/repo/space';
import { serverChange } from '@repo/sync/commands/server-change.server';
import { Clock, Effect } from 'effect';

/** Makes the actor a member of a space in its organization. Joining twice changes nothing. */
export const joinSpaceServer = serverChange(joinSpace, {
  run: (input, { db, actor, refuse }) =>
    Effect.gen(function* () {
      if (input.spaceId === generalSpaceId) {
        return yield* refuse('general-space', 'Everyone is in the general space.');
      }
      const space = yield* findSpace(db, actor.organizationId, input.spaceId);
      if (!space) {
        return yield* refuse('not-found', 'This space does not exist.');
      }
      const existing = yield* findMembership(db, actor.organizationId, space.id, actor.userId);
      if (existing) {
        return [joinedChange(existing)];
      }
      const now = new Date(yield* Clock.currentTimeMillis);
      const member = yield* insertMembership(db, {
        organizationId: actor.organizationId,
        spaceId: space.id,
        userId: actor.userId,
        joinedAt: now,
      });
      return [joinedChange(member)];
    }),
});
