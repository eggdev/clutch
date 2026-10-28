import { generalSpaceId, spaceGroup } from '@repo/access/models/space';
import { findMembership, spacesOf } from '@repo/access/repo/membership';
import type { Actor } from '@repo/identity/types/actor';
import { organizationGroup, userGroup } from '@repo/sync/models/define';
import { Database } from '@repo/sync/service/database';
import type { DrizzleDatabase } from '@repo/sync/service/database';
import type { Granted } from '@repo/sync/service/sync-groups';
import { Context, Effect, Layer } from 'effect';

/**
 * Who may see what. `groupsFor` names the sync groups an actor may load:
 * the organization and the user's own group load at once, and each space of
 * the actor loads when a gate asks for it. `canUseSpace` is the access check
 * that a server change runs in its transaction.
 */
export class Access extends Context.Service<
  Access,
  {
    readonly groupsFor: (actor: Actor) => Effect.Effect<Granted, unknown>;
    readonly canUseSpace: (
      db: DrizzleDatabase,
      actor: Actor,
      spaceId: string,
    ) => Effect.Effect<boolean, unknown>;
  }
>()('access/Access') {}

/**
 * The access check for a record in a space: the general space, or a space
 * the actor is a member of. A server change runs it in its own transaction.
 */
export function canUseSpace(db: DrizzleDatabase, actor: Actor, spaceId: string) {
  return spaceId === generalSpaceId
    ? Effect.succeed(true)
    : findMembership(db, actor.organizationId, spaceId, actor.userId).pipe(Effect.map(Boolean));
}

export const AccessLive = Layer.effect(Access)(
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
      canUseSpace,
    };
  }),
);
