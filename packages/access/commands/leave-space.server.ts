import { leaveSpace } from '@repo/access/commands/leave-space';
import { generalSpaceId } from '@repo/access/models/space';
import { deleteMembership, findMembership, leftChange } from '@repo/access/repo/membership';
import { LeaveSpaceInput } from '@repo/access/types/leave-space';
import { defineServerChange } from '@repo/sync/commands/define.server';
import { CommandRejected } from '@repo/sync/types/command-rejected';
import { Effect } from 'effect';

/** Ends the actor's membership of a space. The general space cannot be left. */
export const leaveSpaceServer = defineServerChange(
  leaveSpace,
  LeaveSpaceInput,
  (input, { db, actor }) =>
    Effect.gen(function* () {
      if (input.spaceId === generalSpaceId) {
        return yield* new CommandRejected({ reason: 'No one can leave the general space.' });
      }
      const member = yield* findMembership(db, actor.organizationId, input.spaceId, actor.userId);
      if (!member) {
        return yield* new CommandRejected({ reason: 'You are not a member of this space.' });
      }
      yield* deleteMembership(db, member);
      return [leftChange(member)];
    }),
);
