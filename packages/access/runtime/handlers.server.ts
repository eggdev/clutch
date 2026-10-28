import { createSpaceServer } from '@repo/access/commands/create-space.server';
import { joinSpaceServer } from '@repo/access/commands/join-space.server';
import { leaveSpaceServer } from '@repo/access/commands/leave-space.server';

/** The server change of each command. The server app passes them to `SyncServer`. */
export const accessServerChanges = [createSpaceServer, joinSpaceServer, leaveSpaceServer];
