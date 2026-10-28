import { membershipModel } from '@repo/access/models/membership';
import { spaceModel } from '@repo/access/models/space';
import type { Space } from '@repo/access/types/space';
import { useRecord, useRecordIds } from '@repo/sync/ui/sync-provider';

/** The IDs of every space of the organization, by name. The general space has no record. */
export function useSpaceIds(): ReadonlyArray<string> {
  return useRecordIds(spaceModel, { by: 'name', direction: 'asc' });
}

/** One space. Only the component that shows it re-renders when it changes. */
export function useSpace(id: string): Space | undefined {
  return useRecord(spaceModel, id);
}

/**
 * Whether the user is a member of a space. The pool holds only the user's
 * own memberships, so a membership of the space means the user is in it.
 */
export function useIsMember(spaceId: string): boolean {
  return useRecordIds(membershipModel, undefined, { field: 'spaceId', equals: spaceId }).length > 0;
}
