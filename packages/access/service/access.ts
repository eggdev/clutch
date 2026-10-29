import { generalSpaceId, spaceGroup, spaceOfGroup } from '@repo/access/models/space';
import { findMembership, spacesOf } from '@repo/access/repo/membership';
import type { Actor } from '@repo/identity/types/actor';
import { organizationGroup, userGroup } from '@repo/sync/models/define';
import { Database } from '@repo/sync/service/database';
import type { DrizzleDatabase } from '@repo/sync/service/database';
import { SyncGroups } from '@repo/sync/service/sync-groups';
import type { Granted } from '@repo/sync/service/sync-groups';
import { Context, Effect, Layer } from 'effect';

/**
 * Who may see what. `groupsFor` names the sync groups an actor may load:
 * the organization and the user's own group load at once, and each space of
 * the actor loads when a gate asks for it. `canUseGroup` is the write check
 * that the sync engine runs for each server change, in its transaction.
 */
export class Access extends Context.Service<
  Access,
  {
    readonly groupsFor: (actor: Actor) => Effect.Effect<Granted, unknown>;
    readonly canUseGroup: (
      db: DrizzleDatabase,
      actor: Actor,
      group: string,
    ) => Effect.Effect<boolean, unknown>;
  }
>()('access/Access') {}

/**
 * The access check for a record in a space: the general space, or a space
 * the actor is a member of. It runs in the transaction it is given.
 */
function canUseSpace(db: DrizzleDatabase, actor: Actor, spaceId: string) {
  return spaceId === generalSpaceId
    ? Effect.succeed(true)
    : findMembership(db, actor.organizationId, spaceId, actor.userId).pipe(Effect.map(Boolean));
}

/**
 * The write check for a record of one sync group. The actor's organization
 * and own user group pass. A space group passes for a member of the space.
 * Every other group fails, so a new kind of group needs a rule here first.
 */
function canUseGroup(db: DrizzleDatabase, actor: Actor, group: string) {
  if (group === organizationGroup(actor.organizationId) || group === userGroup(actor.userId)) {
    return Effect.succeed(true);
  }
  const spaceId = spaceOfGroup(group);
  return spaceId === undefined ? Effect.succeed(false) : canUseSpace(db, actor, spaceId);
}

const AccessLive = Layer.effect(Access)(
  Effect.gen(function* () {
    const db = yield* Database;
    return {
      groupsFor: (actor) =>
        spacesOf(db, actor.organizationId, actor.userId).pipe(
          Effect.map((spaceIds) => ({
            eager: [organizationGroup(actor.organizationId), userGroup(actor.userId)],
            lazy: [generalSpaceId, ...spaceIds].map(spaceGroup),
          })),
        ),
      canUseGroup,
    };
  }),
);

/**
 * The sync engine's `SyncGroups` seam, filled by access. A server app
 * provides this Layer next to `SyncServer`. It also gives `Access`.
 */
export const SyncGroupsFromAccess = Layer.effect(SyncGroups)(
  Access.pipe(
    Effect.map((access) => ({ groupsFor: access.groupsFor, canUse: access.canUseGroup })),
  ),
).pipe(Layer.provideMerge(AccessLive));
