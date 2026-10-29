import { spaceGroup } from '@repo/access/models/space';
import type { SpaceNoteCount } from '@repo/notes/types/space-note-count';
import { defineModel } from '@repo/sync/models/define';

/**
 * Note counts in the object pool. A count is server data: the `count-notes`
 * job writes it, and no command changes it. It is in the group of its space,
 * so it loads with the notes of the space.
 */
export const spaceNoteCountModel = defineModel<SpaceNoteCount>('SpaceNoteCount', {
  fields: { id: 'string', spaceId: 'string', noteCount: 'number', updatedAt: 'string' },
  groupsOf: (count) => [spaceGroup(count.spaceId)],
});
