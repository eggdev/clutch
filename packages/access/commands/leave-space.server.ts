import { generalSpaceId, leaveSpace } from '@repo/access/contract/access';
import { deleteMembership, findMembership, leftChange } from '@repo/access/repo/membership';
import { serverChange } from '@repo/sync/commands/server-change.server';
import { Effect } from 'effect';

/** Ends the actor's membership of a space. The general space cannot be left. */
export const leaveSpaceServer = serverChange(leaveSpace, {
  run: (input, { db, actor, refuse }) =>
    Effect.gen(function* () {
      if (input.spaceId === generalSpaceId) {
        return yield* refuse('general-space', 'No one can leave the general space.');
      }
      const member = yield* findMembership(db, actor.organizationId, input.spaceId, actor.userId);
      if (!member) {
        return yield* refuse('not-a-member', 'You are not a member of this space.');
      }
      yield* deleteMembership(db, member);
      return [leftChange(member)];
    }),
});
