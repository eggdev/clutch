import { expect, test } from 'bun:test';

import { EventLog, EventLogLive } from '@repo/sync/service/event-log';
import { DatabaseTest } from '@repo/sync/testing/database';
import type { Change } from '@repo/sync/types/protocol';
import { Effect, Fiber, Layer, Stream } from 'effect';

const change = (id: string): Change => ({
  model: 'Card',
  id,
  action: 'upsert',
  data: { title: id },
});

function run<A, E>(program: Effect.Effect<A, E, EventLog>) {
  return Effect.runPromise(
    program.pipe(Effect.provide(EventLogLive.pipe(Layer.provide(DatabaseTest())))),
  );
}

test('each organization gets sync IDs that only increase', async () => {
  const ids = await run(
    Effect.gen(function* () {
      const log = yield* EventLog;
      const first = yield* log.commit('org-a', 't1', () => Effect.succeed([change('a')]));
      const second = yield* log.commit('org-a', 't2', () => Effect.succeed([change('b')]));
      const other = yield* log.commit('org-b', 't3', () => Effect.succeed([change('c')]));
      return [first, second, other];
    }),
  );
  expect(ids).toEqual([1, 2, 1]);
});

test('a resent transaction applies once and returns its first sync ID', async () => {
  let writes = 0;
  const write = () =>
    Effect.sync(() => {
      writes += 1;
      return [change('a')];
    });
  const ids = await run(
    Effect.gen(function* () {
      const log = yield* EventLog;
      return [yield* log.commit('org-a', 't1', write), yield* log.commit('org-a', 't1', write)];
    }),
  );
  expect(ids).toEqual([1, 1]);
  expect(writes).toBe(1);
});

test('a failed write leaves no event, and the next write gets the next ID', async () => {
  const ids = await run(
    Effect.gen(function* () {
      const log = yield* EventLog;
      const failed = yield* log
        .commit('org-a', 't1', () => Effect.fail('refused'))
        .pipe(Effect.flip);
      const next = yield* log.commit('org-a', 't2', () => Effect.succeed([change('a')]));
      return [failed, next];
    }),
  );
  expect(ids).toEqual(['refused', 1]);
});

test('a client gets the backlog after its sync ID, then live deltas, its own too', async () => {
  const received = await run(
    Effect.gen(function* () {
      const log = yield* EventLog;
      yield* log.commit('org-a', 't1', () => Effect.succeed([change('a')]));
      yield* log.commit('org-a', 't2', () => Effect.succeed([change('b')]));
      yield* log.commit('org-b', 't3', () => Effect.succeed([change('x')]));
      const reading = yield* log
        .deltas('org-a', 1)
        .pipe(Stream.take(2), Stream.runCollect, Effect.forkChild);
      yield* Effect.sleep('50 millis');
      yield* log.commit('org-a', 't4', () => Effect.succeed([change('c')]));
      return yield* Fiber.join(reading);
    }),
  );
  expect(
    received.map((element) => element.map((delta) => [delta.syncId, delta.transactionId])),
  ).toEqual([[[2, 't2']], [[3, 't4']]]);
});

test('the head is the newest sync ID of an organization, or 0', async () => {
  const heads = await run(
    Effect.gen(function* () {
      const log = yield* EventLog;
      const empty = yield* log.head('org-a');
      yield* log.commit('org-a', 't1', () => Effect.succeed([change('a')]));
      yield* log.commit('org-a', 't2', () => Effect.succeed([change('b')]));
      return [empty, yield* log.head('org-a'), yield* log.head('org-b')];
    }),
  );
  expect(heads).toEqual([0, 2, 0]);
});
