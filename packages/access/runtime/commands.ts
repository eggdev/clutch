import { createSpace } from '@repo/access/commands/create-space';
import { joinSpace } from '@repo/access/commands/join-space';
import { leaveSpace } from '@repo/access/commands/leave-space';

/** The client half of each command. The web app gives them to the object pool. */
export const accessCommands = [createSpace, joinSpace, leaveSpace];
