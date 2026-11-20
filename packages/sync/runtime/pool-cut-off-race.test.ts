import { expect, test } from 'bun:test';

import { loadPool } from '@repo/sync/runtime/boot';
import type { SavedPool } from '@repo/sync/runtime/boot';
import { EventLog, eventLog } from '@repo/sync/service/event-log';
import { feed } from '@repo/sync/service/feed';
import type { LoadRequest } from '@repo/sync/service/feed';
import { DatabaseTest } from '@repo/sync/testing/database';
import { memoryLocalDatabase } from '@repo/sync/testing/local-database';
import { applyMessage, held, randomCards, randomLog, until } from '@repo/sync/testing/random-log';
import { seeded } from '@repo/sync/testing/seeded';
import { Effect, Fiber, Latch, Layer, Queue, Stream } from 'effect';

/**
 * A first pull is cut at a message that the seed picks, as a tab that closes
 * does. Commits land between the messages, and while the device is offline.
 * The next start reads the saved copy and pulls from its position. At the
 * quiet point, the pool and the saved copy each hold exactly the server
 * records of their loaded groups. A seed fixes the cut and each commit with
 * its change. Where a commit lands between the messages also depends on
 * timing.
 */

/**
 * The seeds that run in CI, of 30 that passed. They cut the first pull after
 * message 1 and after message 11, and each runs in about 0.4 s.
 */
const seeds = [13, 2];

const eager = ['org:a', 'space:z'];
const lazy = ['space:x', 'space:y'];

function trial(seed: number) {
  const random = seeded(seed);
  const server = randomLog(random);
  const memory = memoryLocalDatabase();
  let live = true;
  return Effect.gen(function* () {
    const log = yield* EventLog;
    for (let index = 0; index < 25; index += 1) {
      yield* server.commit(log);
    }
    let pool: SavedPool = yield* Effect.promise(() =>
      loadPool(memory, [], [randomCards], undefined, () => {}),
    );
    const cutAt = 1 + Math.floor(random() * 12);
    /**
     * A pull from `lastSyncId` that applies `stopAt` messages and no more.
     * Message `loadAt` asks for `space:y`, and each message may commit.
     */
    const pull = (
      from: { readonly lastSyncId: number; readonly loaded: ReadonlyArray<string> },
      fill: ReadonlyArray<string>,
      loadAt: number,
      stopAt: number,
    ) =>
      Effect.gen(function* () {
        const requests = yield* Queue.unbounded<LoadRequest>();
        const cut = Latch.makeUnsafe(false);
        let count = 0;
        const fiber = yield* feed(log, {
          organizationId: 'org-a',
          userId: 'u',
          ...from,
          fill,
          pages: true,
          granted: Effect.succeed({ eager, lazy }),
          requests,
        }).pipe(
          Stream.runForEach((message) =>
            Effect.gen(function* () {
              if (count >= stopAt) {
                yield* cut.open;
                return yield* Effect.never;
              }
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
        return { fiber, cut };
      });

    const first = yield* pull({ lastSyncId: 0, loaded: ['org:a', 'space:x'] }, [], 2, cutAt);
    yield* Effect.race(first.cut.await, Effect.sleep('2 seconds'));
    yield* Fiber.interrupt(first.fiber);
    pool.endPull();
    yield* Effect.sleep('30 millis');
    yield* Effect.promise(() => pool.stop());
    for (let index = 0; index < 10; index += 1) {
      yield* server.commit(log);
    }
    // The next start reads the saved copy, and names the groups that it holds.
    pool = yield* Effect.promise(() => loadPool(memory, [], [randomCards], undefined, () => {}));
    const named = pool.loadedGroups();
    const lastSyncId = pool.lastSyncId();
    const loaded = [...eager, ...named.filter((group) => lazy.includes(group))];
    const fill = lastSyncId > 0 ? eager.filter((group) => !named.includes(group)) : [];
    const second = yield* pull({ lastSyncId, loaded }, fill, 3, Number.POSITIVE_INFINITY);
    yield* Effect.sleep('60 millis');
    live = false;
    yield* until(
      () =>
        pool.loadedGroups().includes('space:y') &&
        held(pool).join(',') === server.expected(pool.loadedGroups()).join(','),
    );
    yield* Effect.sleep('30 millis');
    const inMemory = { held: held(pool), expected: server.expected(pool.loadedGroups()) };
    yield* Fiber.interrupt(second.fiber);
    const saved = yield* Effect.promise(() => memory.read());
    const copy = {
      held: (saved?.tables['Card'] ?? []).map((row) => `${row.id} ${String(row.title)}`).toSorted(),
      expected: server.expected(saved?.groups ?? []),
    };
    return { cutAt, inMemory, copy };
  }).pipe(
    Effect.provide(eventLog([randomCards], { pageSize: 2 }).pipe(Layer.provide(DatabaseTest()))),
    Effect.runPromise,
  );
}

for (const seed of seeds) {
  test(`seed ${seed}: a pull cut part way, a start from the saved copy and a reconnect end with the server records`, async () => {
    const { inMemory, copy } = await trial(seed);
    expect(inMemory.held).toEqual(inMemory.expected);
    expect(copy.held).toEqual(copy.expected);
  });
}
