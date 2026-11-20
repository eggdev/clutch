import { expect, test } from 'bun:test';

import { defineContract } from '@repo/sync/contract/define';
import { organizationGroup } from '@repo/sync/contract/engine-groups';
import { record } from '@repo/sync/contract/record';
import { WakePglite } from '@repo/sync/runtime/wake.server';
import { Database } from '@repo/sync/service/database';
import { EventLog, eventLog } from '@repo/sync/service/event-log';
import { feed } from '@repo/sync/service/feed';
import type { LoadRequest } from '@repo/sync/service/feed';
import { DatabaseTest } from '@repo/sync/testing/database';
import type { SyncMessage } from '@repo/sync/types/protocol';
import * as PgliteDrizzle from 'drizzle-orm/effect-pglite';
import { Context, Deferred, Effect, Fiber, Layer, Queue, Stream } from 'effect';

const cardRecord = record('Card', {
  fields: { id: 'string', title: 'string' },
  groups: [organizationGroup.ofScope],
});
const cards = defineContract('cards', { records: [cardRecord], commands: [], loads: [] });

/**
 * The database of the test, as Drizzle sees it, with one change: the first
 * read of the head of a log tells `reading`, then waits for `release`. Drizzle
 * logs each query before it runs it, so the logger holds that read. With
 * `fails`, that read then dies, as when the database goes away.
 */
const heldHead = (
  reading: Deferred.Deferred<true>,
  release: Deferred.Deferred<true>,
  fails = false,
) =>
  Layer.effect(Database)(
    Effect.gen(function* () {
      let held = false;
      const logger = PgliteDrizzle.EffectLogger.of({
        logQuery: (query) => {
          if (held || !query.includes('max(')) {
            return Effect.void;
          }
          held = true;
          return Deferred.succeed(reading, true).pipe(
            Effect.andThen(Deferred.await(release)),
            Effect.andThen(fails ? Effect.die(new Error('The database went away.')) : Effect.void),
          );
        },
      });
      return yield* PgliteDrizzle.make().pipe(
        Effect.provideService(PgliteDrizzle.EffectLogger, logger),
        Effect.provide(PgliteDrizzle.DefaultServices),
      );
    }),
  );

/** One server process with its own wake, over the database of the test. */
const serverProcess = () =>
  Layer.fresh(eventLog([cards]).pipe(Layer.provide(Layer.fresh(WakePglite))));

/** One server process whose first head read waits, as `heldHead` says. */
const heldProcess = (...held: Parameters<typeof heldHead>) =>
  Layer.fresh(
    eventLog([cards]).pipe(Layer.provide(Layer.merge(heldHead(...held), Layer.fresh(WakePglite)))),
  );

const commit = (log: Context.Service.Shape<typeof EventLog>, id: string) =>
  log.commit('org-a', `t-${id}`, () =>
    Effect.succeed([
      { model: 'Card', id, action: 'upsert' as const, data: { id, title: id }, groups: ['org:a'] },
    ]),
  );

/** The messages of a new client of `org:a` at sync ID 0. */
const connect = (log: Context.Service.Shape<typeof EventLog>) =>
  Effect.map(Queue.unbounded<LoadRequest>(), (requests) =>
    feed(log, {
      organizationId: 'org-a',
      userId: 'u',
      lastSyncId: 0,
      loaded: ['org:a'],
      granted: Effect.succeed({ eager: ['org:a'], lazy: [] }),
      requests,
    }),
  );

/** The IDs of the cards in a message. */
const cardIds = (message: SyncMessage) =>
  (message._tag === 'Deltas' ? message.deltas : message.backfill).flatMap((delta) =>
    delta.changes.map((change) => change.id),
  );

test('a connection that subscribes while the live reader reads its head gets each event of that time', async () => {
  const received = await Effect.runPromise(
    Effect.gen(function* () {
      const writer = Context.get(yield* Layer.build(serverProcess()), EventLog);
      yield* commit(writer, 'c1');
      const reading = yield* Deferred.make<true>();
      const release = yield* Deferred.make<true>();
      const log = Context.get(yield* Layer.build(heldProcess(reading, release)), EventLog);

      // The first connection makes the reader, and the reader's head read waits.
      const firstOpened = yield* Deferred.make<true>();
      yield* (yield* connect(log)).pipe(
        Stream.tap((message) =>
          message._tag === 'Deltas' ? Deferred.succeed(firstOpened, true) : Effect.void,
        ),
        Stream.runDrain,
        Effect.forkChild,
      );
      yield* Deferred.await(reading);

      // The second connection subscribes now. Its opening ends with the empty delta at its head.
      const secondOpened = yield* Deferred.make<true>();
      const second = yield* (yield* connect(log)).pipe(
        Stream.tap((message) =>
          message._tag === 'Deltas' ? Deferred.succeed(secondOpened, true) : Effect.void,
        ),
        Stream.flatMap((message) => Stream.fromIterable(cardIds(message))),
        Stream.takeUntil((id) => id === 'c3'),
        Stream.runCollect,
        Effect.forkChild,
      );
      // A connection that does not wait for the start of the reader reads its
      // opening well inside this wait. One that waits reads it later.
      yield* Effect.raceFirst(Deferred.await(secondOpened), Effect.sleep('200 millis'));

      // An event commits before the reader reads its head.
      yield* commit(writer, 'c2');
      yield* Deferred.succeed(release, true);
      // The first connection opens once the reader started. Then one more event commits.
      yield* Deferred.await(firstOpened);
      yield* commit(writer, 'c3');
      return [...new Set(yield* Fiber.join(second))].toSorted();
    }).pipe(Effect.scoped, Effect.provide(DatabaseTest())),
  );
  expect(received).toEqual(['c1', 'c2', 'c3']);
});

test('a reader whose head read fails ends each connection that waited for it, and the next connection gets a new reader', async () => {
  const { waited, next } = await Effect.runPromise(
    Effect.gen(function* () {
      const writer = Context.get(yield* Layer.build(serverProcess()), EventLog);
      yield* commit(writer, 'c1');
      const reading = yield* Deferred.make<true>();
      const release = yield* Deferred.make<true>();
      const log = Context.get(yield* Layer.build(heldProcess(reading, release, true)), EventLog);
      const firstMessage = Effect.flatMap(connect(log), (messages) =>
        messages.pipe(Stream.take(1), Stream.runCollect),
      );
      const first = yield* Effect.forkChild(Effect.exit(firstMessage));
      yield* Deferred.await(reading);
      // The second connection finds the reader with no database read, so it waits well inside this time.
      const second = yield* Effect.forkChild(Effect.exit(firstMessage));
      yield* Effect.sleep('50 millis');
      yield* Deferred.succeed(release, true);
      const exits = [yield* Fiber.join(first), yield* Fiber.join(second)];
      const [opening] = yield* firstMessage;
      return {
        waited: exits.map((exit) => exit._tag),
        next: opening ? cardIds(opening) : [],
      };
    }).pipe(Effect.scoped, Effect.provide(DatabaseTest())),
  );
  expect(waited).toEqual(['Failure', 'Failure']);
  expect(next).toEqual(['c1']);
});
