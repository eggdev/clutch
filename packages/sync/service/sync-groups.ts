import type { Actor } from '@repo/identity/types/actor';
import type { DrizzleDatabase } from '@repo/sync/service/database';
import { Context } from 'effect';
import type { Effect } from 'effect';

/**
 * The groups that an actor may load. A client loads each `eager` group when it
 * connects, such as its organization and its user. It loads a `lazy` group
 * only when a gate asks for it, such as one space.
 */
export type Granted = {
  readonly eager: ReadonlyArray<string>;
  readonly lazy: ReadonlyArray<string>;
};

/**
 * The seam between the sync engine and access. The sync server asks it which
 * groups an actor may load. Each server change asks it, in its transaction,
 * whether the actor may write a record of one group. The access package
 * provides it; a test can give fixed groups.
 */
export class SyncGroups extends Context.Service<
  SyncGroups,
  {
    readonly groupsFor: (actor: Actor) => Effect.Effect<Granted, unknown>;
    readonly canUse: (
      db: DrizzleDatabase,
      actor: Actor,
      group: string,
    ) => Effect.Effect<boolean, unknown>;
  }
>()('sync/SyncGroups') {}
