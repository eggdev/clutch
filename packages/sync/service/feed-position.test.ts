import { expect, test } from 'bun:test';

import { defineContract } from '@repo/sync/contract/define';
import { organizationGroup } from '@repo/sync/contract/engine-groups';
import { record } from '@repo/sync/contract/record';
import { EventLog, eventLog } from '@repo/sync/service/event-log';
import { feed } from '@repo/sync/service/feed';
import type { Connection, LoadRequest } from '@repo/sync/service/feed';
import type { Granted } from '@repo/sync/service/sync-groups';
import { DatabaseTest } from '@repo/sync/testing/database';
import type { Change, SyncMessage } from '@repo/sync/types/protocol';
import { Effect, Fiber, Layer, Queue, Stream } from 'effect';
import type { Context } from 'effect';

const cardRecord = record('Card', {
  fields: { id: 'string', title: 'string' },
  groups: [organizationGroup.ofScope],
});
const cards = defineContract('cards', { records: [cardRecord], commands: [], loads: [] });

const change = (id: string, groups: ReadonlyArray<string>): Change => ({
  model: 'Card',
  id,
  action: 'upsert',
  data: { id, title: id },
  groups,
});

type Log = Context.Service.Shape<typeof EventLog>;

function run<A, E>(program: Effect.Effect<A, E, EventLog>) {
  return Effect.runPromise(
    program.pipe(
      Effect.provide(eventLog([cards], { pageSize: 1 }).pipe(Layer.provide(DatabaseTest()))),
    ),
  );
}

/** A feed of user `u` in `org-a`. Each message also goes to `seen`, so a test waits for the one it needs. */
const open = (
  log: Log,
  connection: Partial<Connection> & { readonly granted: Effect.Effect<Granted> },
  seen: Queue.Queue<SyncMessage>,
) =>
  Effect.gen(function* () {
    const requests = yield* Queue.unbounded<LoadRequest>();
    return feed(log, {
      organizationId: 'org-a',
      userId: 'u',
      lastSyncId: 0,
      loaded: ['org:a'],
      requests,
      ...connection,
    }).pipe(Stream.tap((message) => Queue.offer(seen, message)));
  });

/** Takes messages from `seen` until one holds. */
const until = (seen: Queue.Queue<SyncMessage>, holds: (message: SyncMessage) => boolean) =>
  Effect.gen(function* () {
    const taken: Array<SyncMessage> = [];
    let message = yield* Queue.take(seen);
    taken.push(message);
    while (!holds(message)) {
      message = yield* Queue.take(seen);
      taken.push(message);
    }
    return taken;
  });

const isDeltaAt = (syncId: number) => (message: SyncMessage) =>
  message._tag === 'Deltas' && message.deltas.some((delta) => delta.syncId === syncId);

test('the sender moves to the sync ID of its accepted transaction, also when it sees none of its changes', async () => {
  const moved = await run(
    Effect.gen(function* () {
      const log = yield* EventLog;
      yield* log.commit('org-a', 't-a', () => Effect.succeed([change('a', ['org:a'])]));
      const accepted = yield* Queue.unbounded<number>();
      const seen = yield* Queue.unbounded<SyncMessage>();
      const reading = yield* Effect.forkChild(
        Stream.runDrain(
          yield* open(
            log,
            { granted: Effect.succeed({ eager: ['org:a'], lazy: [] }), accepted },
            seen,
          ),
        ),
      );
      // The client holds the snapshot and sync ID 1.
      yield* until(seen, isDeltaAt(1));
      // Its transaction writes only to a group that it did not load.
      const syncId = yield* log.commit('org-a', 't-y', () =>
        Effect.succeed([change('y', ['space:y'])]),
      );
      yield* Queue.offer(accepted, syncId);
      const messages = yield* until(seen, isDeltaAt(syncId));
      yield* Fiber.interrupt(reading);
      return { syncId, last: messages.at(-1) };
    }),
  );
  expect(moved.syncId).toBe(2);
  expect(moved.last).toEqual({
    _tag: 'Deltas',
    deltas: [{ syncId: 2, transactionId: null, changes: [] }],
  });
});

test('an eager group that the actor gains while the socket is open loads with its snapshot', async () => {
  const messages = await run(
    Effect.gen(function* () {
      const log = yield* EventLog;
      yield* log.commit('org-a', 't-b', () => Effect.succeed([change('b', ['org:b'])]));
      const access: { granted: Granted } = { granted: { eager: ['org:a', 'user:u'], lazy: [] } };
      const seen = yield* Queue.unbounded<SyncMessage>();
      const reading = yield* Effect.forkChild(
        Stream.runDrain(
          yield* open(
            log,
            { loaded: ['org:a', 'user:u'], granted: Effect.sync(() => access.granted) },
            seen,
          ),
        ),
      );
      yield* until(seen, isDeltaAt(1));
      // A membership in the user's own group grants the eager group org:b.
      access.granted = { eager: ['org:a', 'user:u', 'org:b'], lazy: [] };
      yield* log.commit('org-a', 't-member', () => Effect.succeed([change('m', ['user:u'])]));
      const taken = yield* until(seen, (message) => message._tag === 'Groups');
      yield* Fiber.interrupt(reading);
      return taken;
    }),
  );
  expect(messages.at(-1)).toMatchObject({
    _tag: 'Groups',
    loaded: ['org:a', 'user:u', 'org:b'],
    backfill: [{ syncId: 1, changes: [{ id: 'b' }] }],
  });
});

test('a client past sync ID 0 that reads pages learns the actor before the first page', async () => {
  const first = await run(
    Effect.gen(function* () {
      const log = yield* EventLog;
      for (const id of ['a', 'b']) {
        yield* log.commit('org-a', `t-${id}`, () => Effect.succeed([change(id, ['space:y'])]));
      }
      const seen = yield* Queue.unbounded<SyncMessage>();
      const messages = yield* open(
        log,
        {
          lastSyncId: 1,
          loaded: ['org:a', 'space:y'],
          fill: ['space:y'],
          pages: true,
          granted: Effect.succeed({ eager: ['org:a', 'space:y'], lazy: [] }),
        },
        seen,
      );
      return yield* messages.pipe(Stream.take(2), Stream.runCollect);
    }),
  );
  expect(first).toEqual([
    {
      _tag: 'Groups',
      loaded: ['org:a'],
      backfill: [],
      actor: { userId: 'u', organizationId: 'org-a' },
    },
    expect.objectContaining({ _tag: 'Page', group: 'space:y' }),
  ]);
});
