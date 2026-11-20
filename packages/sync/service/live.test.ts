import { expect, test } from 'bun:test';

import { defineContract } from '@repo/sync/contract/define';
import { organizationGroup } from '@repo/sync/contract/engine-groups';
import { record } from '@repo/sync/contract/record';
import { WakePglite } from '@repo/sync/runtime/wake.server';
import { EventLog, eventLog } from '@repo/sync/service/event-log';
import { feed } from '@repo/sync/service/feed';
import type { LoadRequest } from '@repo/sync/service/feed';
import { DatabaseTest } from '@repo/sync/testing/database';
import type { Change, SyncMessage } from '@repo/sync/types/protocol';
import { Context, Effect, Fiber, Layer, Queue, Stream } from 'effect';

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
const serverProcess = Layer.fresh(eventLog([cards]).pipe(Layer.provide(Layer.fresh(WakePglite))));

/** How many commits each test makes, some at once. */
const commits = 20;

/** The sync IDs that a client of `org:a` at sync ID 0 gets live from `log`, while `write` runs. */
const liveSyncIds = (
  log: Context.Service.Shape<typeof EventLog>,
  write: Effect.Effect<unknown, unknown>,
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
      Stream.take(commits),
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
      const writer = Context.get(yield* Layer.build(serverProcess), EventLog);
      const reader = Context.get(yield* Layer.build(serverProcess), EventLog);
      return yield* liveSyncIds(reader, writeMany(writer));
    }).pipe(Effect.scoped, Effect.provide(DatabaseTest())),
  );
  expect(syncIds).toEqual(inOrder);
});

test('commits at once in one process reach its connections in sync ID order', async () => {
  const syncIds = await Effect.runPromise(
    Effect.gen(function* () {
      const log = Context.get(yield* Layer.build(serverProcess), EventLog);
      return yield* liveSyncIds(log, writeMany(log));
    }).pipe(Effect.scoped, Effect.provide(DatabaseTest())),
  );
  expect(syncIds).toEqual(inOrder);
});
