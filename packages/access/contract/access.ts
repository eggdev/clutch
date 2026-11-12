import { command } from '@repo/sync/contract/command';
import { defineContract } from '@repo/sync/contract/define';
import { organizationGroup, userGroup } from '@repo/sync/contract/engine-groups';
import { text } from '@repo/sync/contract/fields';
import { defineGroup } from '@repo/sync/contract/groups';
import { record } from '@repo/sync/contract/record';
import type { RowOf } from '@repo/sync/contract/record';

/**
 * The contract of access: spaces, memberships and the commands that change
 * them. This file is the one declaration of each. The object pool, the
 * server, the manifest and each tool read it.
 */

/** The sync groups of spaces. Records of a space, such as notes, name one with `spaceGroup.by`. */
export const spaceGroup = defineGroup('space');

/**
 * The space that each organization has from the start. Every actor in the
 * organization is in it, and no one can leave it. It has no record.
 */
export const generalSpaceId = 'general';

/** The longest space name. The field below and the screen both read it. */
export const maxSpaceNameLength = 80;
/** The name of a space, declared once: the record and the input that creates a space use it. */
const spaceName = text({ max: maxSpaceNameLength });

/**
 * A space. Every actor in the organization gets each space, so each one can
 * see a space and join it. Dates are ISO strings.
 */
export const spaceRecord = record('Space', {
  fields: { id: 'string', name: spaceName, createdAt: 'string', updatedAt: 'string' },
  groups: [organizationGroup.ofScope],
});
export type Space = RowOf<typeof spaceRecord>;

/**
 * One user's membership of one space. It is in the user's own group, so only
 * that user gets it, and a change to it makes the server ask access again
 * which groups the user may load.
 */
export const membershipRecord = record('Membership', {
  fields: { id: 'string', spaceId: 'string', userId: 'string', joinedAt: 'string' },
  groups: [userGroup.by('userId')],
});
export type Membership = RowOf<typeof membershipRecord>;

/** The ID of a membership: one for each space and user. */
export const membershipId = (spaceId: string, userId: string) => `${spaceId}:${userId}`;

/**
 * Creates a space, and the creator joins it. It waits for the server, which
 * checks the name. No command here is a tool: a change to who is a member
 * needs a live person. See docs/contributing/architecture/authorization.md.
 */
export const createSpace = command('access/create-space', {
  input: { id: 'new-id', name: spaceName, at: 'now' },
  waits: 'server',
  access: 'organization',
  refuses: ['name-missing'],
  tool: 'none',
});

/**
 * Joins a space. It waits for the server, which decides who may join. The
 * records of the space load when a gate asks for them.
 */
export const joinSpace = command('access/join-space', {
  input: { spaceId: 'string', at: 'now' },
  waits: 'server',
  access: 'organization',
  refuses: ['general-space'],
  tool: 'none',
});

/**
 * Leaves a space. It waits for the server. When the server confirms it, each
 * client of the user deletes the records of the space.
 */
export const leaveSpace = command('access/leave-space', {
  input: { spaceId: 'string' },
  waits: 'server',
  access: 'organization',
  refuses: ['general-space', 'not-a-member'],
  tool: 'none',
});

export const accessContract = defineContract('access', {
  records: [spaceRecord, membershipRecord],
  commands: [createSpace, joinSpace, leaveSpace],
  loads: [],
});
