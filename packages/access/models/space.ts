import type { Space } from '@repo/access/types/space';
import { defineModel, organizationGroup } from '@repo/sync/models/define';

/**
 * Space records in the object pool. Every actor in the organization gets
 * them, so each one can see a space and join it.
 */
export const spaceModel = defineModel<Space>('Space', {
  fields: { id: 'string', name: 'string', createdAt: 'string', updatedAt: 'string' },
  groupsOf: (_, scope) => [organizationGroup(scope.organizationId)],
});

/**
 * The space that each organization has from the start. Every actor in the
 * organization is in it, and no one can leave it. It has no record.
 */
export const generalSpaceId = 'general';

/** The sync group of one space. Records of the space, such as notes, name it. */
export const spaceGroup = (spaceId: string) => `space:${spaceId}`;

/** The space of a space group, or `undefined` for another kind of group. */
export const spaceOfGroup = (group: string) =>
  group.startsWith('space:') ? group.slice('space:'.length) : undefined;

/** The longest space name. UI code needs it as a value, so it lives here. */
export const maxSpaceNameLength = 80;
