import { createSpace } from '@repo/access/contract/access';
import { insertMembership, joinedChange } from '@repo/access/repo/membership';
import { findSpace, insertSpace, spaceChange } from '@repo/access/repo/space';
import { serverChange } from '@repo/sync/commands/server-change.server';
import { Clock, Effect } from 'effect';

/** Writes the space for the actor's organization, and makes the actor its first member. */
export const createSpaceServer = serverChange(createSpace, {
  run: (input, { db, actor, refuse }) =>
    Effect.gen(function* () {
      const name = input.name.trim();
      if (!name) {
        return yield* refuse('name-missing', 'A space needs a name.');
      }
      const existing = yield* findSpace(db, actor.organizationId, input.id);
      if (existing) {
        return [spaceChange(existing)];
      }
      const now = new Date(yield* Clock.currentTimeMillis);
      const space = yield* insertSpace(db, {
        id: input.id,
        organizationId: actor.organizationId,
        name,
        createdAt: now,
        updatedAt: now,
      });
      const member = yield* insertMembership(db, {
        organizationId: actor.organizationId,
        spaceId: space.id,
        userId: actor.userId,
        joinedAt: now,
      });
      return [spaceChange(space), joinedChange(member)];
    }),
});
