import type { LeaveSpaceInput } from '@repo/access/types/leave-space';
import { defineCommand } from '@repo/sync/commands/define';

/**
 * Leaves a space. It waits for the server. When the server confirms it, each
 * client of the user deletes the records of the space.
 */
export const leaveSpace = defineCommand<LeaveSpaceInput>({
  name: 'access/leave-space',
  waits: 'server',
});
