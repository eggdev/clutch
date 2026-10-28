import { Access, AccessLive } from '@repo/access/service/access';
import { SyncGroups } from '@repo/sync/service/sync-groups';
import { Effect, Layer } from 'effect';

/**
 * The sync engine's `SyncGroups` seam, filled by access. A server app
 * provides this Layer next to `SyncServer`, and `Access` for its server
 * changes.
 */
export const SyncGroupsFromAccess = Layer.effect(SyncGroups)(
  Access.pipe(Effect.map((access) => ({ groupsFor: access.groupsFor }))),
).pipe(Layer.provideMerge(AccessLive));
