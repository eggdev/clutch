import { afterEach, expect, test } from 'bun:test';

import { defineContract } from '@repo/sync/contract/define';
import { organizationGroup } from '@repo/sync/contract/engine-groups';
import { record } from '@repo/sync/contract/record';
import { EventLog, eventLog } from '@repo/sync/service/event-log';
import { feed } from '@repo/sync/service/feed';
import type { Granted } from '@repo/sync/service/sync-groups';
import { DatabaseTest } from '@repo/sync/testing/database';
import type { Change, SyncMessage } from '@repo/sync/types/protocol';
import { Effect, Fiber, Layer, Queue, Stream } from 'effect';
import type { Context } from 'effect';

/** A card of the organization, so each change of `Card` fits a declared record. */
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

function run<A, E>(program: Effect.Effect<A, E, EventLog>) {
  return Effect.runPromise(
    program.pipe(Effect.provide(eventLog([cards]).pipe(Layer.provide(DatabaseTest())))),
  );
}

const everything = (): Granted => ({ eager: ['org:a', 'user:u'], lazy: ['space:x', 'space:y'] });

/** The groups each actor may load now. A test changes it to take a group away. */
const access = { granted: everything() };

// Each test starts with full access, whatever the test before it changed.
afterEach(() => {
  access.granted = everything();
});

/**
 * Opens a feed for user `u` in `org-a` and takes `count` messages. Each message
 * also goes to `seen`, so a test waits for the one it needs with
 * `Queue.take(seen)` instead of a fixed sleep. The feed subscribes before its
 * first message, so a commit after that message reaches it.
 */
function open(
  log: Context.Service.Shape<typeof EventLog>,
  options: { readonly loaded: ReadonlyArray<string>; readonly lastSyncId?: number },
  requests: Queue.Queue<string>,
  seen: Queue.Queue<SyncMessage>,
  count: number,
) {
  return feed(log, {
    organizationId: 'org-a',
    userId: 'u',
    lastSyncId: options.lastSyncId ?? 0,
    loaded: options.loaded,
    granted: Effect.sync(() => access.granted),
    requests,
  }).pipe(
    Stream.take(count),
    Stream.tap((message) => Queue.offer(seen, message)),
    Stream.runCollect,
    Effect.forkChild,
  );
}

/** A short form of each message, for one assertion. */
function summary(messages: ReadonlyArray<SyncMessage>) {
  return messages.map((message) =>
    message._tag === 'Deltas'
      ? `deltas ${message.deltas.map((delta) => delta.changes.map((item) => item.id).join('+')).join(',')}`
      : `groups ${message.loaded.toSorted().join('+')} backfill ${message.backfill.map((delta) => delta.changes.map((item) => item.id).join('+')).join(',')}`,
  );
}

test('a client gets only the changes of its loaded groups, from the backlog and live', async () => {
  const messages = await run(
    Effect.gen(function* () {
      const log = yield* EventLog;
      yield* log.commit('org-a', 't1', () => Effect.succeed([change('a', ['space:x'])]));
      yield* log.commit('org-a', 't2', () => Effect.succeed([change('b', ['space:y'])]));
      const requests = yield* Queue.unbounded<string>();
      const seen = yield* Queue.unbounded<SyncMessage>();
      const reading = yield* open(log, { loaded: ['org:a', 'space:x'] }, requests, seen, 3);
      yield* Queue.take(seen);
      yield* log.commit('org-a', 't3', () =>
        Effect.succeed([change('c', ['space:y']), change('d', ['space:x'])]),
      );
      yield* log.commit('org-a', 't4', () => Effect.succeed([change('e', ['space:x'])]));
      return yield* Fiber.join(reading).pipe(Effect.timeout('2 seconds'));
    }),
  );
  expect(summary(messages)).toEqual(['groups org:a+space:x backfill ', 'deltas a', 'deltas d']);
});

test('loading a group sends its past changes once, then its live changes', async () => {
  const messages = await run(
    Effect.gen(function* () {
      const log = yield* EventLog;
      yield* log.commit('org-a', 't1', () => Effect.succeed([change('a', ['space:y'])]));
      const requests = yield* Queue.unbounded<string>();
      const seen = yield* Queue.unbounded<SyncMessage>();
      const reading = yield* open(log, { loaded: ['org:a'] }, requests, seen, 3);
      yield* Queue.take(seen);
      yield* Queue.offer(requests, 'space:y');
      // The backfill message: the group is loaded before the live change.
      yield* Queue.take(seen);
      yield* log.commit('org-a', 't2', () => Effect.succeed([change('b', ['space:y'])]));
      return yield* Fiber.join(reading).pipe(Effect.timeout('2 seconds'));
    }),
  );
  expect(summary(messages)).toEqual([
    'groups org:a backfill ',
    'groups org:a+space:y backfill a',
    'deltas b',
  ]);
});

test('a group the actor may not load is not loaded', async () => {
  const messages = await run(
    Effect.gen(function* () {
      const log = yield* EventLog;
      const requests = yield* Queue.unbounded<string>();
      const seen = yield* Queue.unbounded<SyncMessage>();
      const reading = yield* open(log, { loaded: ['org:a'] }, requests, seen, 2);
      yield* Queue.take(seen);
      // Requests run in order. The allowed group's message comes after the
      // refused one was handled, so it shows the refused group was not added.
      yield* Queue.offer(requests, 'space:secret');
      yield* Queue.offer(requests, 'space:x');
      return yield* Fiber.join(reading).pipe(Effect.timeout('2 seconds'));
    }),
  );
  expect(summary(messages)).toEqual(['groups org:a backfill ', 'groups org:a+space:x backfill ']);
});

test('a change to the user group asks access again, and a lost group leaves the loaded set', async () => {
  const messages = await run(
    Effect.gen(function* () {
      const log = yield* EventLog;
      const requests = yield* Queue.unbounded<string>();
      const seen = yield* Queue.unbounded<SyncMessage>();
      const reading = yield* open(
        log,
        { loaded: ['org:a', 'user:u', 'space:x'] },
        requests,
        seen,
        3,
      );
      yield* Queue.take(seen);
      access.granted = { eager: ['org:a', 'user:u'], lazy: ['space:y'] };
      yield* log.commit('org-a', 't1', () => Effect.succeed([change('m', ['user:u'])]));
      return yield* Fiber.join(reading).pipe(Effect.timeout('2 seconds'));
    }),
  );
  expect(summary(messages)).toEqual([
    'groups org:a+space:x+user:u backfill ',
    'deltas m',
    'groups org:a+user:u backfill ',
  ]);
});

/** Each change of each message as `id action`, with the backfill of a `Groups` message. */
function actions(messages: ReadonlyArray<SyncMessage>) {
  return messages.map((message) => {
    const deltas = message._tag === 'Deltas' ? message.deltas : message.backfill;
    const changes = deltas.flatMap((delta) =>
      delta.changes.map((item) => `${item.id} ${item.action}`),
    );
    return `${message._tag} ${changes.join(',')}`;
  });
}

/** Card `a` is filed in space x, then moves to space y. */
const moveCard = (log: Context.Service.Shape<typeof EventLog>) =>
  Effect.gen(function* () {
    yield* log.commit('org-a', 't1', () => Effect.succeed([change('a', ['space:x'])]));
    yield* log.commit('org-a', 't2', () => Effect.succeed([change('a', ['space:y'])]));
  });

test('the backlog shows a move as a delete to a client of the old group, and as an upsert to one of the new group', async () => {
  const [old, next, neither] = await run(
    Effect.gen(function* () {
      const log = yield* EventLog;
      yield* moveCard(log);
      const read = (loaded: ReadonlyArray<string>) =>
        Effect.gen(function* () {
          const requests = yield* Queue.unbounded<string>();
          const seen = yield* Queue.unbounded<SyncMessage>();
          const reading = yield* open(log, { loaded }, requests, seen, 2);
          return yield* Fiber.join(reading).pipe(Effect.timeout('2 seconds'));
        });
      const ofOld = yield* read(['org:a', 'space:x']);
      const ofNew = yield* read(['org:a', 'space:y']);
      // A client of neither group gets nothing of the move: its next message is a later change.
      yield* log.commit('org-a', 't3', () => Effect.succeed([change('z', ['org:a'])]));
      return [ofOld, ofNew, yield* read(['org:a'])];
    }),
  );
  expect(actions(old)).toEqual(['Groups ', 'Deltas a upsert,a delete']);
  expect(actions(next)).toEqual(['Groups ', 'Deltas a upsert']);
  expect(actions(neither)).toEqual(['Groups ', 'Deltas z upsert']);
  // The delete names no data, so a client of the old group does not see where the record went.
  const removal = old[1]?._tag === 'Deltas' ? old[1].deltas[1]?.changes[0] : undefined;
  expect(removal).toEqual({
    model: 'Card',
    id: 'a',
    action: 'delete',
    data: null,
    groups: ['space:x'],
  });
});

test('a live move reaches each client as what it is for that client', async () => {
  const [old, both] = await run(
    Effect.gen(function* () {
      const log = yield* EventLog;
      yield* log.commit('org-a', 't1', () => Effect.succeed([change('a', ['space:x'])]));
      const reader = (loaded: ReadonlyArray<string>, seen: Queue.Queue<SyncMessage>) =>
        Queue.unbounded<string>().pipe(
          Effect.flatMap((requests) => open(log, { loaded, lastSyncId: 1 }, requests, seen, 2)),
        );
      const oldSeen = yield* Queue.unbounded<SyncMessage>();
      const bothSeen = yield* Queue.unbounded<SyncMessage>();
      const oldReading = yield* reader(['org:a', 'space:x'], oldSeen);
      const bothReading = yield* reader(['org:a', 'space:x', 'space:y'], bothSeen);
      yield* Queue.take(oldSeen);
      yield* Queue.take(bothSeen);
      yield* log.commit('org-a', 't2', () => Effect.succeed([change('a', ['space:y'])]));
      return [
        yield* Fiber.join(oldReading).pipe(Effect.timeout('2 seconds')),
        yield* Fiber.join(bothReading).pipe(Effect.timeout('2 seconds')),
      ];
    }),
  );
  expect(actions(old)).toEqual(['Groups ', 'Deltas a delete']);
  expect(actions(both)).toEqual(['Groups ', 'Deltas a upsert']);
});

test('a backfill shows a move by the groups that the client has loaded, not only the new one', async () => {
  const [old, withNew] = await run(
    Effect.gen(function* () {
      const log = yield* EventLog;
      yield* moveCard(log);
      const loadOld = (loaded: ReadonlyArray<string>) =>
        Effect.gen(function* () {
          const requests = yield* Queue.unbounded<string>();
          const seen = yield* Queue.unbounded<SyncMessage>();
          const reading = yield* open(log, { loaded, lastSyncId: 2 }, requests, seen, 2);
          yield* Queue.take(seen);
          yield* Queue.offer(requests, 'space:x');
          return yield* Fiber.join(reading).pipe(Effect.timeout('2 seconds'));
        });
      return [yield* loadOld(['org:a']), yield* loadOld(['org:a', 'space:y'])];
    }),
  );
  expect(actions(old)).toEqual(['Groups ', 'Groups a upsert,a delete']);
  // The client holds the card through space y, so the move is an upsert for it.
  expect(actions(withNew)).toEqual(['Groups ', 'Groups a upsert,a upsert']);
});
