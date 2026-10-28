import type { JoinSpaceInput } from '@repo/access/types/join-space';
import { defineCommand } from '@repo/sync/commands/define';

/**
 * Joins a space. It waits for the server, which decides who may join. The
 * records of the space load when a gate asks for them.
 */
export const joinSpace = defineCommand<JoinSpaceInput>({
  name: 'access/join-space',
  waits: 'server',
});
