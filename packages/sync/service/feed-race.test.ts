import { expect, test } from 'bun:test';

import { createPool } from '@repo/sync/runtime/pool';
import { EventLog, eventLog } from '@repo/sync/service/event-log';
import { feed } from '@repo/sync/service/feed';
import type { LoadRequest } from '@repo/sync/service/feed';
import { DatabaseTest } from '@repo/sync/testing/database';
import {
  applyMessage,
  held,
  randomCard,
  randomCards,
  randomLog,
  until,
} from '@repo/sync/testing/random-log';
import { seeded } from '@repo/sync/testing/seeded';
import { Effect, Fiber, Layer, Queue, Stream } from 'effect';

/**
 * Commits land between the messages of a pull, a lazy group loads in the
 * middle of a backfill, and the connection drops and comes back from the
 * position of the pool. At each quiet point the pool holds exactly the
 * server records of its loaded groups. A seed fixes each commit and its
 * change. Where a commit lands between the messages also depends on timing.
 */

/**
 * The seeds that run in CI, of 30 that passed. Each runs in about 0.4 s. In
 * seed 8 the position of the pool stays behind the head at a quiet point.
 */
const seeds = [3, 8, 17, 26];

function trial(seed: number) {
  const random = seeded(seed);
  const server = randomLog(random);
  let live = true;
  return Effect.gen(function* () {
    const log = yield* EventLog;
    for (let index = 0; index < 25; index += 1) {
      yield* server.commit(log);
    }
    const pool = createPool([], { records: [randomCard], commands: [] }, { report: () => {} });
    /** A pull from `lastSyncId`. Message `loadAt` asks for `space:y`, and each message may commit. */
    const pull = (lastSyncId: number, loaded: ReadonlyArray<string>, loadAt: number) =>
      Effect.gen(function* () {
        const requests = yield* Queue.unbounded<LoadRequest>();
        let count = 0;
        return yield* feed(log, {
          organizationId: 'org-a',
          userId: 'u',
          lastSyncId,
          loaded,
          fill: [],
          pages: true,
          granted: Effect.succeed({ eager: ['org:a'], lazy: ['space:x', 'space:y', 'space:z'] }),
          requests,
        }).pipe(
          Stream.runForEach((message) =>
            Effect.gen(function* () {
              applyMessage(pool, message);
              count += 1;
              if (count === loadAt) {
                yield* Queue.offer(requests, { group: 'space:y', pages: true });
              }
              if (live && random() < 0.6) {
                yield* server.commit(log);
              }
              if (live && random() < 0.3) {
                yield* server.commit(log);
              }
            }),
          ),
          Effect.forkChild,
        );
      });
    /**
     * Stops the commits, waits until the pool holds the server records with
     * `space:y` loaded, and gives what it holds 20 ms later. The position may
     * stay behind the head: an event that changes only a group that the pool
     * does not load never reaches it.
     */
    const quiet = Effect.gen(function* () {
      live = false;
      yield* until(
        () =>
          pool.loadedGroups().includes('space:y') &&
          held(pool).join(',') === server.expected(pool.loadedGroups()).join(','),
      );
      yield* Effect.sleep('20 millis');
      return { held: held(pool), expected: server.expected(pool.loadedGroups()) };
    });

    const first = yield* pull(0, ['org:a', 'space:x'], 3);
    for (let index = 0; index < 5; index += 1) {
      yield* Effect.sleep('5 millis');
      yield* server.commit(log);
    }
    const afterFirst = yield* quiet;
    yield* Fiber.interrupt(first);
    pool.endPull();
    // Commits while the device is offline, then a pull from the position of the pool.
    for (let index = 0; index < 15; index += 1) {
      yield* server.commit(log);
    }
    live = true;
    const second = yield* pull(pool.lastSyncId(), pool.loadedGroups(), 2);
    yield* Effect.sleep('20 millis');
    const afterSecond = yield* quiet;
    yield* Fiber.interrupt(second);
    return { afterFirst, afterSecond };
  }).pipe(
    Effect.provide(eventLog([randomCards], { pageSize: 2 }).pipe(Layer.provide(DatabaseTest()))),
    Effect.runPromise,
  );
}

for (const seed of seeds) {
  test(`seed ${seed}: a pull with commits between its messages, a load and a reconnect ends with the server records`, async () => {
    const { afterFirst, afterSecond } = await trial(seed);
    expect(afterFirst.held).toEqual(afterFirst.expected);
    expect(afterSecond.held).toEqual(afterSecond.expected);
  });
}
