import { expect, test } from 'bun:test';

import { defineContract } from '@repo/sync/contract/define';
import { organizationGroup } from '@repo/sync/contract/engine-groups';
import { record } from '@repo/sync/contract/record';
import { WakePglite } from '@repo/sync/runtime/wake.server';
import { EventLog, eventLog } from '@repo/sync/service/event-log';
import { feed } from '@repo/sync/service/feed';
import type { LoadRequest } from '@repo/sync/service/feed';
import { Wake } from '@repo/sync/service/wake';
import type { WakeSignal } from '@repo/sync/service/wake';
import { DatabaseTest } from '@repo/sync/testing/database';
import type { Change, SyncMessage } from '@repo/sync/types/protocol';
import { Context, Deferred, Effect, Fiber, Layer, Queue, Stream } from 'effect';
import type { Duration } from 'effect';

const cardRecord = record('Card', {
  fields: { id: 'string', title: 'string' },
  groups: [organizationGroup.ofScope],
});
const cards = defineContract('cards', { records: [cardRecord], commands: [], loads: [] });

const upsert = (id: string): Change => ({
  model: 'Card',
  id,
  action: 'upsert',
  data: { id, title: id },
  groups: ['org:a'],
});

/** One server process: an event log with its own wake, over the database of the test. */
const serverProcess = (wake = WakePglite) =>
  Layer.fresh(eventLog([cards]).pipe(Layer.provide(Layer.fresh(wake))));

/** A wake over the database whose `send` always fails. A commit does not use `send`. */
const failingSend = Layer.effect(Wake)(
  Effect.gen(function* () {
    return Wake.of({ ...(yield* Wake), send: () => Effect.fail('down') });
  }),
).pipe(Layer.provide(Layer.fresh(WakePglite)));

/** A process whose wake hears only `heard`, as when its listener is down. */
const deafProcess = (heard: Stream.Stream<WakeSignal>, rereadEvery?: Duration.Input) =>
  Layer.fresh(
    eventLog([cards], { rereadEvery }).pipe(
      Layer.provide(
        Layer.succeed(Wake)(
          Wake.of({ send: () => Effect.void, sendOnCommit: () => Effect.void, signals: heard }),
        ),
      ),
    ),
  );

/** How many commits each test makes, some at once. */
const commits = 20;

/** The first `count` sync IDs that a client of `org:a` at sync ID 0 gets live from `log`, while `write` runs. */
const liveSyncIds = (
  log: Context.Service.Shape<typeof EventLog>,
  write: Effect.Effect<unknown, unknown>,
  count = commits,
) =>
  Effect.gen(function* () {
    const requests = yield* Queue.unbounded<LoadRequest>();
    const opened = yield* Queue.unbounded<true>();
    const reading = yield* feed(log, {
      organizationId: 'org-a',
      userId: 'u',
      lastSyncId: 0,
      loaded: ['org:a'],
      granted: Effect.succeed({ eager: ['org:a'], lazy: [] }),
      requests,
    }).pipe(
      Stream.tap(() => Queue.offer(opened, true)),
      Stream.flatMap((message: SyncMessage) =>
        Stream.fromIterable(message._tag === 'Deltas' ? message.deltas : []),
      ),
      Stream.take(count),
      Stream.runCollect,
      Effect.forkChild,
    );
    // The feed subscribes before its first message, so no commit after it is missed.
    yield* Queue.take(opened);
    yield* write;
    const deltas = yield* Fiber.join(reading).pipe(Effect.timeout('5 seconds'));
    return deltas.map((delta) => delta.syncId);
  });

/** Commits `commits` cards through `log`, five at a time. */
const writeMany = (log: Context.Service.Shape<typeof EventLog>) =>
  Effect.forEach(
    Array.from({ length: commits }, (_, index) => `c${index + 1}`),
    (id) => log.commit('org-a', `t-${id}`, () => Effect.succeed([upsert(id)])),
    { concurrency: 5 },
  );

const inOrder = Array.from({ length: commits }, (_, index) => index + 1);

test('a commit through one process reaches a connection of another, in order, with none dropped', async () => {
  const syncIds = await Effect.runPromise(
    Effect.gen(function* () {
      const writer = Context.get(yield* Layer.build(serverProcess()), EventLog);
      const reader = Context.get(yield* Layer.build(serverProcess()), EventLog);
      return yield* liveSyncIds(reader, writeMany(writer));
    }).pipe(Effect.scoped, Effect.provide(DatabaseTest())),
  );
  expect(syncIds).toEqual(inOrder);
});

test('commits at once in one process reach its connections in sync ID order', async () => {
  const syncIds = await Effect.runPromise(
    Effect.gen(function* () {
      const log = Context.get(yield* Layer.build(serverProcess()), EventLog);
      return yield* liveSyncIds(log, writeMany(log));
    }).pipe(Effect.scoped, Effect.provide(DatabaseTest())),
  );
  expect(syncIds).toEqual(inOrder);
});

test('a commit reaches another process when the wake cannot send outside a commit', async () => {
  const syncIds = await Effect.runPromise(
    Effect.gen(function* () {
      const writer = Context.get(yield* Layer.build(serverProcess(failingSend)), EventLog);
      const reader = Context.get(yield* Layer.build(serverProcess()), EventLog);
      return yield* liveSyncIds(reader, writeMany(writer));
    }).pipe(Effect.scoped, Effect.provide(DatabaseTest())),
  );
  expect(syncIds).toEqual(inOrder);
});

test('an event committed while a process does not listen reaches it when it listens again', async () => {
  const syncIds = await Effect.runPromise(
    Effect.gen(function* () {
      const again = yield* Deferred.make<WakeSignal>();
      const writer = Context.get(yield* Layer.build(serverProcess()), EventLog);
      const heard = Stream.fromEffect(Deferred.await(again));
      const reader = Context.get(yield* Layer.build(deafProcess(heard)), EventLog);
      // The commit ends before the reader hears anything. Then its wake listens again.
      const write = writer
        .commit('org-a', 't-c1', () => Effect.succeed([upsert('c1')]))
        .pipe(Effect.andThen(Deferred.succeed(again, { kind: 'listening' })));
      return yield* liveSyncIds(reader, write, 1);
    }).pipe(Effect.scoped, Effect.provide(DatabaseTest())),
  );
  expect(syncIds).toEqual([1]);
});

test('a process that hears no signal reads the log again at a fixed interval', async () => {
  const syncIds = await Effect.runPromise(
    Effect.gen(function* () {
      const writer = Context.get(yield* Layer.build(serverProcess()), EventLog);
      const reader = Context.get(
        yield* Layer.build(deafProcess(Stream.never, '50 millis')),
        EventLog,
      );
      return yield* liveSyncIds(reader, writeMany(writer));
    }).pipe(Effect.scoped, Effect.provide(DatabaseTest())),
  );
  expect(syncIds).toEqual(inOrder);
});
