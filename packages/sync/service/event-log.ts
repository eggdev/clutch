import { appendEvent, eventsAfter, findTransaction, headOf } from '@repo/sync/repo/events';
import { Database } from '@repo/sync/service/database';
import type { DrizzleDatabase } from '@repo/sync/service/database';
import type { Change, Delta } from '@repo/sync/types/protocol';
import { Context, Effect, Layer, Option, PubSub, Stream } from 'effect';

/** At most this many deltas go in one stream element, so one decode stays short. */
const deltasPerElement = 1000;

type Commit = <E, R>(
  organizationId: string,
  transactionId: string,
  write: (db: DrizzleDatabase) => Effect.Effect<ReadonlyArray<Change>, E, R>,
) => Effect.Effect<number, unknown, R>;

/**
 * The append-only log of one server. `commit` writes the owner records and
 * the event in one database transaction, then publishes the delta after the
 * commit. `deltas` sends the backlog after a sync ID, then live deltas above
 * the backlog's last ID, to every client of the organization, sender too.
 */
export class EventLog extends Context.Service<
  EventLog,
  {
    readonly commit: Commit;
    readonly head: (organizationId: string) => Effect.Effect<number, unknown>;
    readonly deltas: (
      organizationId: string,
      lastSyncId: number,
    ) => Stream.Stream<ReadonlyArray<Delta>, unknown>;
  }
>()('sync/EventLog') {}

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
            const syncId = yield* appendEvent(tx, organizationId, transactionId, changes);
            return { syncId, delta: { syncId, transactionId, changes } };
          }),
        );
        if (result.delta) {
          yield* PubSub.publish(yield* hubOf(organizationId), result.delta);
        }
        return result.syncId;
      });

    const backlog = (organizationId: string, after: number) =>
      Stream.paginate(after, (cursor) =>
        eventsAfter(db, organizationId, cursor, deltasPerElement).pipe(
          Effect.map((page) => {
            const last = page.at(-1)?.syncId;
            const next = page.length === deltasPerElement && last !== undefined ? last : undefined;
            return [
              page.length ? [page] : [],
              next === undefined ? Option.none() : Option.some(next),
            ] as const;
          }),
        ),
      );

    const deltas = (organizationId: string, lastSyncId: number) =>
      Stream.unwrap(
        Effect.gen(function* () {
          const subscription = yield* PubSub.subscribe(yield* hubOf(organizationId));
          let watermark = lastSyncId;
          const pages = backlog(organizationId, lastSyncId).pipe(
            Stream.tap((page) =>
              Effect.sync(() => {
                watermark = page.at(-1)?.syncId ?? watermark;
              }),
            ),
          );
          const live = Stream.fromSubscription(subscription).pipe(
            Stream.filter((delta) => delta.syncId > watermark),
            Stream.map((delta): ReadonlyArray<Delta> => [delta]),
          );
          return Stream.concat(pages, live);
        }),
      );

    return { commit, deltas, head: (organizationId: string) => headOf(db, organizationId) };
  }),
);
