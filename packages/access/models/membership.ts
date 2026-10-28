import type { Membership } from '@repo/access/types/membership';
import { defineModel, userGroup } from '@repo/sync/models/define';

/**
 * A user's memberships in the object pool. A membership is in the user's own
 * group, so only that user gets it, and a change to it makes the server ask
 * access again which groups the user may load.
 */
export const membershipModel = defineModel<Membership>('Membership', {
  groupsOf: (membership) => [userGroup(membership.userId)],
});

/** The ID of a membership: one for each space and user. */
export const membershipId = (spaceId: string, userId: string) => `${spaceId}:${userId}`;
