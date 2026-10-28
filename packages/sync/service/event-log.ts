import {
  appendEvent,
  eventsAfter,
  eventsUpTo,
  findTransaction,
  headOf,
} from '@repo/sync/repo/events';
import { Database } from '@repo/sync/service/database';
import type { DrizzleDatabase } from '@repo/sync/service/database';
import type { Change, Delta } from '@repo/sync/types/protocol';
import { Context, Effect, Layer, Option, PubSub, Stream } from 'effect';
import type { Scope } from 'effect';

/** At most this many events go in one stream element, so one decode stays short. */
const deltasPerElement = 1000;

type Commit = <E, R>(
  organizationId: string,
  transactionId: string,
  write: (db: DrizzleDatabase) => Effect.Effect<ReadonlyArray<Change>, E, R>,
) => Effect.Effect<number, unknown, R>;

/** One page of the backlog: the visible deltas, and the sync ID of the last event read. */
export type BacklogPage = { readonly deltas: ReadonlyArray<Delta>; readonly last: number };

/**
 * The append-only log of one server. `commit` writes the owner records and
 * the event in one database transaction, then publishes the delta after the
 * commit. Each change must name its sync groups. `backlog`, `backfill` and
 * `subscribe` give a connection its events; see `service/feed.ts`.
 */
export class EventLog extends Context.Service<
  EventLog,
  {
    readonly commit: Commit;
    readonly head: (organizationId: string) => Effect.Effect<number, unknown>;
    /** The events after a sync ID that touch the groups, in pages. */
    readonly backlog: (
      organizationId: string,
      lastSyncId: number,
      groups: ReadonlySet<string>,
    ) => Stream.Stream<BacklogPage, unknown>;
    /** Every event up to a sync ID that touches the groups. */
    readonly backfill: (
      organizationId: string,
      upTo: number,
      groups: ReadonlySet<string>,
    ) => Effect.Effect<ReadonlyArray<Delta>, unknown>;
    /** Every new event of the organization, from now on. */
    readonly subscribe: (
      organizationId: string,
    ) => Effect.Effect<PubSub.Subscription<Delta>, never, Scope.Scope>;
  }
>()('sync/EventLog') {}

/** A change with no group reaches no client, so a server change must name them. */
function checkGroups(changes: ReadonlyArray<Change>) {
  const missing = changes.find((change) => change.groups.length === 0);
  return missing
    ? Effect.die(
        new Error(
          `The change of ${missing.model} ${missing.id} has no sync groups. Build it with upsertChange or deleteChange from @repo/sync/models/change.`,
        ),
      )
    : Effect.void;
}

export const EventLogLive = Layer.effect(EventLog)(
  Effect.gen(function* () {
    const db = yield* Database;
    const hubs = new Map<string, PubSub.PubSub<Delta>>();
    const hubOf = (organizationId: string) =>
      Effect.gen(function* () {
        const existing = hubs.get(organizationId);
        if (existing) {
          return existing;
        }
        const hub = yield* PubSub.unbounded<Delta>();
        hubs.set(organizationId, hub);
        return hub;
      });

    const commit: Commit = (organizationId, transactionId, write) =>
      Effect.gen(function* () {
        const result = yield* db.transaction((tx) =>
          Effect.gen(function* () {
            const known = yield* findTransaction(tx, organizationId, transactionId);
            if (known !== undefined) {
              return { syncId: known, delta: null };
            }
            const changes = yield* write(tx);
            yield* checkGroups(changes);
            const syncId = yield* appendEvent(tx, organizationId, transactionId, changes);
            return { syncId, delta: { syncId, transactionId, changes } };
          }),
        );
        if (result.delta) {
          yield* PubSub.publish(yield* hubOf(organizationId), result.delta);
        }
        return result.syncId;
      });

    const backlog = (organizationId: string, after: number, groups: ReadonlySet<string>) =>
      Stream.paginate(after, (cursor) =>
        eventsAfter(db, organizationId, cursor, groups, deltasPerElement).pipe(
          Effect.map((page) => {
            const last = page.last ?? cursor;
            return [
              page.last === undefined ? [] : [{ deltas: page.deltas, last }],
              page.full ? Option.some(last) : Option.none(),
            ] as const;
          }),
        ),
      );

    return {
      commit,
      head: (organizationId: string) => headOf(db, organizationId),
      backlog,
      backfill: (organizationId, upTo, groups) => eventsUpTo(db, organizationId, upTo, groups),
      subscribe: (organizationId) =>
        Effect.flatMap(hubOf(organizationId), (hub) => PubSub.subscribe(hub)),
    };
  }),
);
