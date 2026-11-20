import { eventsSince, headOf } from '@repo/sync/repo/events';
import type { DrizzleDatabase } from '@repo/sync/service/database';
import type { Delta } from '@repo/sync/types/protocol';
import { Effect, PubSub, Queue, Schedule } from 'effect';
import type { Scope } from 'effect';

/** The live deltas of one organization in this process, and the wakes that make it read. */
type Reader = { readonly hub: PubSub.PubSub<Delta>; readonly wakes: Queue.Queue<true> };

/** Reads the events after `mark`, a page at a time, publishes each one, and moves `mark`. */
function readFrom(
  db: DrizzleDatabase,
  pageSize: number,
  organizationId: string,
  hub: PubSub.PubSub<Delta>,
  mark: { last: number },
) {
  return Effect.gen(function* () {
    let full = true;
    while (full) {
      const page = yield* eventsSince(db, organizationId, mark.last, pageSize);
      yield* PubSub.publishAll(hub, page.deltas);
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
 * reader runs until the scope closes.
 */
export function liveDeltas(db: DrizzleDatabase, pageSize: number) {
  return Effect.gen(function* () {
    const scope = yield* Effect.scope;
    const readers = new Map<string, Reader>();

    const readerOf = (organizationId: string) =>
      Effect.gen(function* () {
        const known = readers.get(organizationId);
        if (known) {
          return known;
        }
        const reader: Reader = {
          hub: yield* PubSub.unbounded<Delta>(),
          wakes: yield* Queue.sliding<true>(1),
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
        const read = readFrom(db, pageSize, organizationId, reader.hub, mark).pipe(
          Effect.tapCause((cause) =>
            Effect.logWarning('A live reader could not read the log', cause),
          ),
          Effect.retry(Schedule.spaced('1 second')),
        );
        yield* Queue.take(reader.wakes).pipe(
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
        Effect.flatMap(readerOf(organizationId), (reader) => PubSub.subscribe(reader.hub)),
      /** The log of the organization has new events. Nothing reads when no connection follows it. */
      wake: (organizationId: string) =>
        Effect.suspend(() => {
          const reader = readers.get(organizationId);
          return reader ? Queue.offer(reader.wakes, true) : Effect.void;
        }).pipe(Effect.asVoid),
      /** Each reader reads again, such as after a lost signal. */
      wakeAll: Effect.suspend(() =>
        Effect.forEach(readers.values(), (reader) => Queue.offer(reader.wakes, true), {
          discard: true,
        }),
      ),
    };
  });
}
