import { userGroup } from '@repo/sync/contract/engine-groups';
import type { EventLog } from '@repo/sync/service/event-log';
import type { Granted } from '@repo/sync/service/sync-groups';
import { seenDelta } from '@repo/sync/service/visible';
import type { Delta, SyncMessage } from '@repo/sync/types/protocol';
import { Effect, Stream } from 'effect';
import type { Context, Queue } from 'effect';

/** One open `Pull` stream: who it is for, and the groups it has loaded. */
export type Connection = {
  readonly organizationId: string;
  readonly userId: string;
  readonly lastSyncId: number;
  /** The groups to load first: each eager group, and each lazy one the client had before. */
  readonly loaded: ReadonlyArray<string>;
  /**
   * Loaded groups whose records the client lacks, such as an eager group that
   * it did not name. The first messages hold their snapshot.
   */
  readonly fill?: ReadonlyArray<string>;
  /** The client reads a snapshot in `Page` messages. */
  readonly pages?: boolean;
  /** The groups the actor may load now. It runs again after a change to the user's group. */
  readonly granted: Effect.Effect<Granted, unknown>;
  /** Groups that `Load` asked for. */
  readonly requests: Queue.Queue<LoadRequest>;
};

/** One `Load`: the group, and whether the client reads its snapshot in pages. */
export type LoadRequest = { readonly group: string; readonly pages: boolean };

const groupsMessage = (
  loaded: ReadonlySet<string>,
  backfill: ReadonlyArray<Delta>,
): SyncMessage => ({ _tag: 'Groups', loaded: [...loaded], backfill });

type Input =
  | { readonly kind: 'delta'; readonly delta: Delta }
  | { readonly kind: 'load'; readonly request: LoadRequest };

/**
 * The messages of one connection. It sends the loaded groups first, with the
 * snapshot of each group in `fill`, then the backlog of those groups, then
 * each live event in sync ID order. A client at sync ID 0 gets the snapshot of
 * each loaded group instead of the backlog, and then an empty delta at the
 * head, so it saves that sync ID. A `Load` request adds a group and sends its
 * snapshot: in `Page` messages and a last `Groups` message when the client
 * reads pages, else in one `Groups` message. A snapshot holds the last change
 * of each live record, so its cost follows the records, not their history.
 * The messages of one input go out before the next input runs, so no other
 * message comes between two pages. A change in the user's own
 * group, such as a membership, makes it ask access again; each group the
 * actor lost leaves the loaded set, and the client deletes its records.
 */
export function feed(log: Context.Service.Shape<typeof EventLog>, connection: Connection) {
  return Stream.unwrap(
    Effect.gen(function* () {
      const { organizationId } = connection;
      // Subscribe before the backlog, so no event falls between the two.
      const subscription = yield* log.subscribe(organizationId);
      const loaded = new Set(connection.loaded);
      // Every event up to the head is in the backlog, the snapshot, or in no
      // loaded group. A live event at or below it is a copy. A snapshot can
      // hold a newer change of a record, and the live event of that change
      // comes too: the pool keeps the change with the higher sync ID.
      let watermark = Math.max(connection.lastSyncId, yield* log.head(organizationId));

      const backlog = log.backlog(organizationId, connection.lastSyncId, loaded).pipe(
        Stream.tap((page) =>
          Effect.sync(() => {
            watermark = Math.max(watermark, page.last);
          }),
        ),
        Stream.filter((page) => page.deltas.length > 0),
        Stream.map((page): SyncMessage => ({ _tag: 'Deltas', deltas: page.deltas })),
      );

      const onDelta = (delta: Delta) =>
        Effect.gen(function* () {
          if (delta.syncId <= watermark) {
            return [];
          }
          watermark = delta.syncId;
          const out: Array<SyncMessage> = [];
          const seen = seenDelta(delta, loaded);
          if (seen) {
            out.push({ _tag: 'Deltas', deltas: [seen] });
          }
          const own = userGroup.of(connection.userId);
          if (delta.changes.some((change) => change.groups.includes(own))) {
            const granted = yield* connection.granted;
            const allowed = new Set([...granted.eager, ...granted.lazy]);
            const lost = [...loaded].filter((group) => !allowed.has(group));
            if (lost.length) {
              for (const group of lost) {
                loaded.delete(group);
              }
              out.push(groupsMessage(loaded, []));
            }
          }
          return out;
        });

      // The snapshot of `groups`. A client that reads pages gets `Page`
      // messages, and the last page in the `Groups` message. Another client
      // gets one `Groups` message. A record in two of the groups comes once.
      const snapshotMessages = (
        groups: ReadonlyArray<string>,
        pages: boolean,
      ): Stream.Stream<SyncMessage, unknown> =>
        Stream.unwrap(
          Effect.gen(function* () {
            const now = new Set(loaded);
            const read = (group: string, index: number) =>
              log.snapshot(organizationId, group, new Set(groups.slice(0, index)));
            if (!pages) {
              const all = yield* Stream.runCollect(
                Stream.flatMap(Stream.fromIterable(groups.entries()), ([index, group]) =>
                  read(group, index),
                ),
              );
              return Stream.make(
                groupsMessage(
                  now,
                  all.flatMap((page) => page.deltas),
                ),
              );
            }
            const lastGroup = groups.at(-1);
            if (lastGroup === undefined) {
              return Stream.make(groupsMessage(now, []));
            }
            return Stream.fromIterable(groups.entries()).pipe(
              Stream.flatMap(([index, group]) =>
                read(group, index).pipe(
                  Stream.flatMap(({ deltas, more }) => {
                    if (!more && group === lastGroup) {
                      return Stream.make(groupsMessage(now, deltas));
                    }
                    const page: SyncMessage = { _tag: 'Page', group, backfill: deltas };
                    return deltas.length ? Stream.make(page) : Stream.empty;
                  }),
                ),
              ),
            );
          }),
        );

      const onLoad = ({
        group,
        pages,
      }: LoadRequest): Effect.Effect<Stream.Stream<SyncMessage, unknown>, unknown> =>
        Effect.gen(function* () {
          if (loaded.has(group)) {
            return Stream.make(groupsMessage(loaded, []));
          }
          const granted = yield* connection.granted;
          if (![...granted.eager, ...granted.lazy].includes(group)) {
            return Stream.empty;
          }
          loaded.add(group);
          return snapshotMessages([group], pages);
        });

      const live = Stream.merge(
        Stream.fromSubscription(subscription).pipe(
          Stream.map((delta): Input => ({ kind: 'delta', delta })),
        ),
        Stream.fromQueue(connection.requests).pipe(
          Stream.map((request): Input => ({ kind: 'load', request })),
        ),
      ).pipe(
        Stream.flatMap((input) =>
          input.kind === 'delta'
            ? Stream.unwrap(Effect.map(onDelta(input.delta), (out) => Stream.fromIterable(out)))
            : Stream.unwrap(onLoad(input.request)),
        ),
      );

      const pages = connection.pages ?? false;
      if (connection.lastSyncId === 0) {
        // A client at sync ID 0 holds nothing: it gets the snapshot of each
        // loaded group. The empty delta at the head then moves its last sync
        // ID there, so its next pull asks only for the events after it.
        const head = watermark;
        const atHead: ReadonlyArray<SyncMessage> =
          head > 0
            ? [{ _tag: 'Deltas', deltas: [{ syncId: head, transactionId: null, changes: [] }] }]
            : [];
        return Stream.concat(
          Stream.concat(snapshotMessages([...loaded], pages), Stream.fromIterable(atHead)),
          live,
        );
      }
      // The first `Groups` message holds the snapshot of each group to fill.
      // The backlog sends the events after the last sync ID.
      const opening = snapshotMessages(
        (connection.fill ?? []).filter((group) => loaded.has(group)),
        pages,
      );
      return Stream.concat(Stream.concat(opening, backlog), live);
    }),
  );
}
