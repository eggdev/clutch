import type { Actor } from '@repo/identity/types/actor';
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
 * groups an actor may load. The access package provides it; a test can give
 * fixed groups.
 */
export class SyncGroups extends Context.Service<
  SyncGroups,
  { readonly groupsFor: (actor: Actor) => Effect.Effect<Granted, unknown> }
>()('sync/SyncGroups') {}
