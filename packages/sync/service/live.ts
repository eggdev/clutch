import { eventsSince, headOf } from '@repo/sync/repo/events';
import type { DrizzleDatabase } from '@repo/sync/service/database';
import type { Delta } from '@repo/sync/types/protocol';
import { Effect, PubSub, Queue, Schedule } from 'effect';
import type { Scope } from 'effect';

/** The live deltas of one organization in this process, the wakes that make it read, and its connections. */
type Reader = {
  readonly hub: PubSub.PubSub<Delta>;
  readonly wakes: Queue.Queue<true>;
  followers: number;
  /** A wake came since the last read began. */
  heard: boolean;
  /** The read that runs now came from the timer alone, with no wake before it. */
  timed: boolean;
};

/**
 * Logs that a read of the timer found events that no wake announced, so a
 * wake was lost. Each loss then shows in the logs, and the timed read hides
 * none.
 */
function logLostWake(organizationId: string, deltas: ReadonlyArray<Delta>) {
  return Effect.logWarning(
    'A timed read of the log found events that no wake announced, so a wake was lost',
  ).pipe(
    Effect.annotateLogs({
      organizationId,
      events: deltas.length,
      firstSyncId: deltas[0]?.syncId,
      lastSyncId: deltas.at(-1)?.syncId,
    }),
  );
}

/**
 * Reads the events after `mark`, a page at a time, publishes each one, and
 * moves `mark`. A read of the timer logs each page that it finds before it
 * publishes the page, unless a wake comes while it reads: that wake can
 * announce the same events.
 */
function readFrom(
  db: DrizzleDatabase,
  pageSize: number,
  organizationId: string,
  reader: Reader,
  mark: { last: number },
) {
  return Effect.gen(function* () {
    let full = true;
    while (full) {
      const page = yield* eventsSince(db, organizationId, mark.last, pageSize);
      if (reader.timed && !reader.heard && page.deltas.length > 0) {
        yield* logLostWake(organizationId, page.deltas);
      }
      yield* PubSub.publishAll(reader.hub, page.deltas);
      mark.last = page.last ?? mark.last;
      ({ full } = page);
    }
  });
}

/**
 * The live deltas of each organization, read from the log. A process keeps
 * one reader for each organization that a connection follows. A wake makes
 * the reader read each event after its mark, in sync ID order, and publish
 * it to the connections of this process. Two wakes that come while it reads
 * make one more read, so no event goes out twice. The order comes from the
 * log, so a connection never gets an older event after a newer one. Each
 * reader runs until the scope closes. A reader that missed a wake catches up
 * at its next read, because it reads from its mark. `reread` is the read of
 * the timer: when it finds events that no wake announced, it logs a warning.
 */
export function liveDeltas(db: DrizzleDatabase, pageSize: number) {
  return Effect.gen(function* () {
    const scope = yield* Effect.scope;
    const readers = new Map<string, Reader>();
    const following = () => [...readers.values()].filter((reader) => reader.followers > 0);
    const wakeReader = (reader: Reader) =>
      Effect.suspend(() => {
        reader.heard = true;
        return Queue.offer(reader.wakes, true);
      }).pipe(Effect.asVoid);

    const readerOf = (organizationId: string) =>
      Effect.gen(function* () {
        const known = readers.get(organizationId);
        if (known) {
          return known;
        }
        const reader: Reader = {
          hub: yield* PubSub.unbounded<Delta>(),
          wakes: yield* Queue.sliding<true>(1),
          followers: 0,
          heard: false,
          timed: false,
        };
        readers.set(organizationId, reader);
        // Every event up to the head was committed before the first
        // subscriber: its connection reads it from the log. A commit after it
        // wakes the reader, because the reader is in `readers` already.
        // When the head cannot be read, the reader goes, and the next connection tries again.
        const head = yield* headOf(db, organizationId).pipe(
          Effect.tapError(() => Effect.sync(() => readers.delete(organizationId))),
        );
        const mark = { last: head };
        const read = readFrom(db, pageSize, organizationId, reader, mark).pipe(
          Effect.tapCause((cause) =>
            Effect.logWarning('A live reader could not read the log', cause),
          ),
          Effect.retry(Schedule.spaced('1 second')),
        );
        // A read with no wake since the last one began is a read of the timer.
        const begin = Effect.sync(() => {
          reader.timed = !reader.heard;
          reader.heard = false;
        });
        yield* Queue.take(reader.wakes).pipe(
          Effect.andThen(begin),
          Effect.andThen(read),
          Effect.forever,
          Effect.forkIn(scope),
        );
        return reader;
      });

    return {
      /** Every new event of the organization, from now on, in sync ID order. */
      subscribe: (
        organizationId: string,
      ): Effect.Effect<PubSub.Subscription<Delta>, unknown, Scope.Scope> =>
        Effect.gen(function* () {
          const reader = yield* readerOf(organizationId);
          reader.followers += 1;
          yield* Effect.addFinalizer(() => Effect.sync(() => (reader.followers -= 1)));
          return yield* PubSub.subscribe(reader.hub);
        }),
      /** The log of the organization has new events. Nothing reads when no connection follows it. */
      wake: (organizationId: string) =>
        Effect.suspend(() => {
          const reader = readers.get(organizationId);
          return reader ? wakeReader(reader) : Effect.void;
        }),
      /** Each reader with a connection reads again, such as after the wake listens again. */
      wakeAll: Effect.suspend(() => Effect.forEach(following(), wakeReader, { discard: true })),
      /** The read of the timer: each reader with a connection reads again, with no wake. */
      reread: Effect.suspend(() =>
        Effect.forEach(following(), (reader) => Queue.offer(reader.wakes, true), {
          discard: true,
        }),
      ),
    };
  });
}
