import { spaceModel } from '@repo/access/models/space';
import type { CreateSpaceInput } from '@repo/access/types/create-space';
import { defineCommand } from '@repo/sync/commands/define';

/** Creates a space, and the creator joins it. It waits for the server, which checks the name. */
export const createSpace = defineCommand<CreateSpaceInput>({
  name: 'access/create-space',
  waits: 'server',
  input: { id: 'string', name: 'string', at: 'string' },
  apply: (draft, input) =>
    draft.put(spaceModel, {
      id: input.id,
      name: input.name,
      createdAt: input.at,
      updatedAt: input.at,
    }),
});
