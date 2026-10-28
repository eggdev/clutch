import { userGroup } from '@repo/sync/models/define';
import type { EventLog } from '@repo/sync/service/event-log';
import type { Granted } from '@repo/sync/service/sync-groups';
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
  /** The groups the actor may load now. It runs again after a change to the user's group. */
  readonly granted: Effect.Effect<Granted, unknown>;
  /** Groups that `Load` asked for. */
  readonly requests: Queue.Queue<string>;
};

const groupsMessage = (
  loaded: ReadonlySet<string>,
  backfill: ReadonlyArray<Delta>,
): SyncMessage => ({ _tag: 'Groups', loaded: [...loaded], backfill });

/** The part of a delta in the loaded groups, or nothing. */
function visible(delta: Delta, loaded: ReadonlySet<string>): Delta | undefined {
  const changes = delta.changes.filter((change) =>
    change.groups.some((group) => loaded.has(group)),
  );
  return changes.length ? { ...delta, changes } : undefined;
}

type Input =
  | { readonly kind: 'delta'; readonly delta: Delta }
  | { readonly kind: 'load'; readonly group: string };

/**
 * The messages of one connection. It sends the loaded groups first, then the
 * backlog of those groups, then each live event in sync ID order. A `Load`
 * request adds a group and sends its backfill. A change in the user's own
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
      // Every event up to the head is in the backlog or in no loaded group.
      // A backfill reads up to here, and a live event at or below it is a copy.
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
          const seen = visible(delta, loaded);
          if (seen) {
            out.push({ _tag: 'Deltas', deltas: [seen] });
          }
          const own = userGroup(connection.userId);
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

      const onLoad = (group: string) =>
        Effect.gen(function* () {
          if (loaded.has(group)) {
            return [groupsMessage(loaded, [])];
          }
          const granted = yield* connection.granted;
          if (![...granted.eager, ...granted.lazy].includes(group)) {
            return [];
          }
          loaded.add(group);
          const backfill = yield* log.backfill(organizationId, watermark, new Set([group]));
          return [groupsMessage(loaded, backfill)];
        });

      const live = Stream.merge(
        Stream.fromSubscription(subscription).pipe(
          Stream.map((delta): Input => ({ kind: 'delta', delta })),
        ),
        Stream.fromQueue(connection.requests).pipe(
          Stream.map((group): Input => ({ kind: 'load', group })),
        ),
      ).pipe(
        Stream.mapEffect((input) =>
          input.kind === 'delta' ? onDelta(input.delta) : onLoad(input.group),
        ),
        Stream.flatMap((messages) => Stream.fromIterable(messages)),
      );

      return Stream.concat(Stream.concat(Stream.make(groupsMessage(loaded, [])), backlog), live);
    }),
  );
}
