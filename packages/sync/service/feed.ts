import { userGroup } from '@repo/sync/contract/engine-groups';
import type { EventLog } from '@repo/sync/service/event-log';
import type { Granted } from '@repo/sync/service/sync-groups';
import { seenDelta } from '@repo/sync/service/visible';
import type { Delta, SyncMessage } from '@repo/sync/types/protocol';
import { ServerBehind } from '@repo/sync/types/server-behind';
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
  /**
   * The sync ID of each transaction of this client that the server accepted.
   * The client's position moves there, also when the event holds nothing
   * that the client sees.
   */
  readonly accepted?: Queue.Queue<number>;
};

/** One `Load`: the group, and whether the client reads its snapshot in pages. */
export type LoadRequest = { readonly group: string; readonly pages: boolean };

type Input =
  | { readonly kind: 'delta'; readonly delta: Delta }
  | { readonly kind: 'load'; readonly request: LoadRequest }
  | { readonly kind: 'accepted'; readonly syncId: number };

/** A delta with no changes, which moves the client's last sync ID to `syncId`. */
const emptyDelta = (syncId: number): SyncMessage => ({
  _tag: 'Deltas',
  deltas: [{ syncId, transactionId: null, changes: [] }],
});

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
 * message comes between two pages. A client whose last sync ID is older than
 * the log, after a trim, gets `ServerBehind`, and loads again from 0. A change in the user's own
 * group, such as a membership, makes it ask access again; each group the
 * actor lost leaves the loaded set, and the client deletes its records, and
 * each eager group that it gained loads, with its snapshot. The first
 * message names the actor, also when pages come before the first loaded
 * group. When a transaction of this client is accepted, the client gets an
 * empty delta at its sync ID once each event before it went out, so the
 * client stops waiting for it even when it sees none of its changes.
 */
export function feed(log: Context.Service.Shape<typeof EventLog>, connection: Connection) {
  return Stream.unwrap(
    Effect.gen(function* () {
      const { organizationId, userId } = connection;
      const readsPages = connection.pages ?? false;
      // The first `Groups` message names the actor, so the client drops a
      // saved copy of another actor before it sends anything.
      let named = false;
      const groupsMessage = (
        loaded: ReadonlySet<string>,
        backfill: ReadonlyArray<Delta>,
      ): SyncMessage => {
        const actor = named ? {} : { actor: { userId, organizationId } };
        named = true;
        return { _tag: 'Groups', loaded: [...loaded], backfill, ...actor };
      };
      // Subscribe before the backlog, so no event falls between the two. The
      // subscription sends each event after the start of the reader, and the
      // head read next is at or after that start.
      const subscription = yield* log.subscribe(organizationId);
      const loaded = new Set(connection.loaded);
      // Every event up to the head is in the backlog, the snapshot, or in no
      // loaded group. A live event at or below it is a copy. A snapshot can
      // hold a newer change of a record, and the live event of that change
      // comes too: the pool keeps the change with the higher sync ID.
      let watermark = Math.max(connection.lastSyncId, yield* log.head(organizationId));
      // The last sync ID that the client holds, after each delta sent to it.
      let position = connection.lastSyncId;
      // The sync IDs of accepted transactions that the feed has not reached yet.
      let accepted: ReadonlyArray<number> = [];
      // Moves the client to the newest accepted sync ID that the feed has
      // reached, when no delta took it there. Each event up to the watermark
      // went out before, so the client misses none.
      const moveToAccepted = (): ReadonlyArray<SyncMessage> => {
        const reached = accepted.filter((syncId) => syncId <= watermark);
        accepted = accepted.filter((syncId) => syncId > watermark);
        const newest = Math.max(0, ...reached);
        if (newest <= position) {
          return [];
        }
        position = newest;
        return [emptyDelta(newest)];
      };

      const backlog = log.backlog(organizationId, connection.lastSyncId, loaded).pipe(
        Stream.tap((page) =>
          Effect.sync(() => {
            watermark = Math.max(watermark, page.last);
            position = Math.max(position, page.deltas.at(-1)?.syncId ?? 0);
          }),
        ),
        Stream.filter((page) => page.deltas.length > 0),
        Stream.map((page): SyncMessage => ({ _tag: 'Deltas', deltas: page.deltas })),
      );

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
                    if (!deltas.length) {
                      return Stream.empty;
                    }
                    const page: SyncMessage = { _tag: 'Page', group, backfill: deltas };
                    // The first message of a pull names the actor, so the
                    // client drops a copy of another actor before the first
                    // page. It loads only the groups that have no page to come.
                    return named
                      ? Stream.make(page)
                      : Stream.make(
                          groupsMessage(
                            new Set([...now].filter((known) => !groups.includes(known))),
                            [],
                          ),
                          page,
                        );
                  }),
                ),
              ),
            );
          }),
        );

      // A change in the user's own group asks access again. Each group that
      // the actor lost leaves the loaded set. Each eager group that it gained
      // loads, as at the start of a pull, and its snapshot names the groups.
      const regrant = (): Stream.Stream<SyncMessage, unknown> =>
        Stream.unwrap(
          Effect.gen(function* () {
            const granted = yield* connection.granted;
            const allowed = new Set([...granted.eager, ...granted.lazy]);
            const lost = [...loaded].filter((group) => !allowed.has(group));
            const gained = granted.eager.filter((group) => !loaded.has(group));
            for (const group of lost) {
              loaded.delete(group);
            }
            for (const group of gained) {
              loaded.add(group);
            }
            if (gained.length) {
              return snapshotMessages(gained, readsPages);
            }
            return lost.length ? Stream.make(groupsMessage(loaded, [])) : Stream.empty;
          }),
        );

      const onDelta = (delta: Delta): Stream.Stream<SyncMessage, unknown> => {
        if (delta.syncId <= watermark) {
          return Stream.empty;
        }
        watermark = delta.syncId;
        const out: Array<SyncMessage> = [];
        const seen = seenDelta(delta, loaded);
        if (seen) {
          position = delta.syncId;
          out.push({ _tag: 'Deltas', deltas: [seen] });
        }
        out.push(...moveToAccepted());
        const own = userGroup.of(connection.userId);
        return delta.changes.some((change) => change.groups.includes(own))
          ? Stream.concat(Stream.fromIterable(out), regrant())
          : Stream.fromIterable(out);
      };

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

      const live = Stream.mergeAll(
        [
          Stream.fromSubscription(subscription).pipe(
            Stream.map((delta): Input => ({ kind: 'delta', delta })),
          ),
          Stream.fromQueue(connection.requests).pipe(
            Stream.map((request): Input => ({ kind: 'load', request })),
          ),
          connection.accepted
            ? Stream.fromQueue(connection.accepted).pipe(
                Stream.map((syncId): Input => ({ kind: 'accepted', syncId })),
              )
            : Stream.empty,
        ],
        { concurrency: 'unbounded' },
      ).pipe(
        Stream.flatMap((input) => {
          if (input.kind === 'delta') {
            return onDelta(input.delta);
          }
          if (input.kind === 'load') {
            return Stream.unwrap(onLoad(input.request));
          }
          accepted = [...accepted, input.syncId];
          return Stream.fromIterable(moveToAccepted());
        }),
      );

      if (connection.lastSyncId === 0) {
        // A client at sync ID 0 holds nothing: it gets the snapshot of each
        // loaded group. The empty delta at the head then moves its last sync
        // ID there, so its next pull asks only for the events after it.
        const head = watermark;
        position = head;
        const atHead: ReadonlyArray<SyncMessage> = head > 0 ? [emptyDelta(head)] : [];
        return Stream.concat(
          Stream.concat(snapshotMessages([...loaded], readsPages), Stream.fromIterable(atHead)),
          live,
        );
      }
      // The log must still hold each event after the last sync ID. A trim
      // drops the oldest events, so a client behind the log loads again.
      const keptSince = Effect.gen(function* () {
        const oldest = yield* log.oldest(organizationId);
        return connection.lastSyncId < oldest - 1
          ? yield* new ServerBehind({ head: watermark, oldest })
          : undefined;
      });
      yield* keptSince;
      // The first `Groups` message holds the snapshot of each group to fill.
      // The backlog sends the events after the last sync ID. A trim that ran
      // while the backlog was read can have dropped some of them, so the log
      // is checked again after it. A trim drops a run of sync IDs from the
      // first, so when the oldest is still in reach, no event was missed.
      const opening = snapshotMessages(
        (connection.fill ?? []).filter((group) => loaded.has(group)),
        readsPages,
      );
      return Stream.concat(
        Stream.concat(opening, backlog),
        Stream.concat(Stream.fromEffect(keptSince).pipe(Stream.drain), live),
      );
    }),
  );
}
