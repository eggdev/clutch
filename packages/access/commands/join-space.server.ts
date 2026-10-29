import { joinSpace } from '@repo/access/commands/join-space';
import { generalSpaceId } from '@repo/access/models/space';
import { findMembership, insertMembership, joinedChange } from '@repo/access/repo/membership';
import { findSpace } from '@repo/access/repo/space';
import { JoinSpaceInput } from '@repo/access/types/join-space';
import { defineServerChange } from '@repo/sync/commands/define.server';
import { CommandRejected } from '@repo/sync/types/command-rejected';
import { Clock, Effect } from 'effect';

/** Makes the actor a member of a space in its organization. Joining twice changes nothing. */
export const joinSpaceServer = defineServerChange(joinSpace, {
  input: JoinSpaceInput,
  access: 'organization',
  run: (input, { db, actor }) =>
    Effect.gen(function* () {
      if (input.spaceId === generalSpaceId) {
        return yield* new CommandRejected({ reason: 'Everyone is in the general space.' });
      }
      const space = yield* findSpace(db, actor.organizationId, input.spaceId);
      if (!space) {
        return yield* new CommandRejected({ reason: 'This space does not exist.' });
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
