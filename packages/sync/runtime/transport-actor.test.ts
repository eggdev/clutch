import { expect, test } from 'bun:test';

import { createPool } from '@repo/sync/runtime/pool';
import type { Pool } from '@repo/sync/runtime/pool';
import { engine } from '@repo/sync/runtime/transport';
import {
  poolState,
  testCommand,
  testGroup,
  testModel,
  testStamps,
} from '@repo/sync/testing/pool-state';
import { SyncRpcs } from '@repo/sync/types/protocol';
import type { SyncActor, SyncMessage, Transaction } from '@repo/sync/types/protocol';
import { Deferred, Effect, Schedule, Stream } from 'effect';
import { RpcTest } from 'effect/rpc';

/**
 * The actor gate of the engine, against handlers in memory. The engine sends
 * no `Push` on a connection before the first `Groups` message of its pull
 * confirmed the actor.
 */

const card = testModel('Card', { id: 'string', title: 'string' });
const archive = testCommand('cards/archive', { id: 'string' }, 'server');
const declared = { records: [card], commands: [archive] };

const ana = { userId: 'ana', organizationId: 'acme' };
const ben = { userId: 'ben', organizationId: 'acme' };

type PullCall = { readonly lastSyncId: number; readonly groups: ReadonlyArray<string> };

function sessionStays() {
  // No test ends the session.
}

/** The first message of a pull, with the actor that the server names, if any. */
function opening(actor?: SyncActor): SyncMessage {
  return { _tag: 'Groups', loaded: [testGroup], backfill: [], ...(actor ? { actor } : {}) };
}

/** Each sentence that a pool of this file reports. */
let reported: Array<string> = [];

/** A pool with Ana's copy: one card at sync ID 9 and one waiting transaction. */
function anasPool(): Pool {
  reported = [];
  const pool = createPool([], declared, {
    stamps: testStamps(),
    report: (line) => reported.push(line),
  });
  pool.load({
    ...poolState({
      lastSyncId: 9,
      tables: { Card: [{ id: 'a', title: 'Saved' }] },
      pending: [{ id: 't-ana', command: 'cards/archive', input: { id: 'a' } }],
    }),
    actor: ana,
  });
  return pool;
}

type Seen = {
  readonly pushes: ReadonlyArray<ReadonlyArray<string>>;
  readonly pulls: ReadonlyArray<PullCall>;
};

/** Waits until `done` holds, for at most 5 seconds. */
function until(done: () => boolean) {
  return Effect.suspend(() => (done() ? Effect.void : Effect.fail('not yet'))).pipe(
    Effect.retry(Schedule.spaced('10 millis')),
    Effect.timeout('5 seconds'),
  );
}

/**
 * Runs the engine while `script` runs, and gives each push and each pull.
 * The handlers answer each push with no outcome, so a pushed transaction
 * stays in the queue and goes again.
 */
async function run(
  pool: Pool,
  pull: (index: number) => Stream.Stream<SyncMessage>,
  script: (seen: Seen) => Effect.Effect<unknown, unknown>,
): Promise<Seen> {
  const seen = { pushes: new Array<ReadonlyArray<string>>(), pulls: new Array<PullCall>() };
  const handlers = SyncRpcs.toLayer({
    Push: ({ transactions }) =>
      Effect.sync(() => {
        seen.pushes.push(transactions.map((transaction: Transaction) => transaction.id));
        return [];
      }),
    Pull: (call) => {
      seen.pulls.push({ lastSyncId: call.lastSyncId, groups: call.groups });
      return pull(seen.pulls.length - 1);
    },
    Load: () => Effect.void,
  });
  await Effect.runPromise(
    Effect.gen(function* () {
      const client = yield* RpcTest.makeClient(SyncRpcs);
      yield* Effect.forkScoped(engine(pool, client, 'digest', sessionStays));
      yield* script(seen);
    }).pipe(Effect.scoped, Effect.provide(handlers)),
  );
  return seen;
}

test('the engine pushes nothing before the first Groups message of the pull', async () => {
  const pool = anasPool();
  // A pull that sends no message keeps the waiting transaction on the device.
  const { pushes, pulls } = await run(
    pool,
    () => Stream.never,
    () => Effect.sleep('300 millis'),
  );
  expect(pulls).toHaveLength(1);
  expect(pushes).toEqual([]);
});

test('the first Groups message that names the same actor opens the pushes', async () => {
  const pool = anasPool();
  const { pushes } = await run(
    pool,
    () => Stream.concat(Stream.make(opening(ana)), Stream.never),
    (seen) => until(() => seen.pushes.length > 0),
  );
  expect(pushes[0]).toEqual(['t-ana']);
  expect(pool.ids(card)).toEqual(['a']);
});

/** A delta after the opening, which would land on the old copy. The engine never applies it. */
const lateDelta: SyncMessage = {
  _tag: 'Deltas',
  deltas: [
    {
      syncId: 10,
      transactionId: null,
      changes: [
        {
          model: 'Card',
          id: 'old',
          action: 'upsert',
          data: { id: 'old', title: 'Old' },
          groups: [testGroup],
        },
      ],
    },
  ],
};

test('another actor drops the copy before any push, and the engine pulls again from 0', async () => {
  const pool = anasPool();
  const { pushes, pulls } = await run(
    pool,
    (index) =>
      Stream.concat(
        index === 0 ? Stream.make(opening(ben), lateDelta) : Stream.make(opening(ben)),
        Stream.never,
      ),
    (seen) =>
      Effect.gen(function* () {
        yield* until(() => seen.pulls.length === 2 && pool.loadedGroups().length > 0);
        pool.run(archive, { id: 'b' });
        yield* until(() => seen.pushes.length > 0);
      }),
  );
  expect(pulls).toEqual([
    { lastSyncId: 9, groups: [testGroup] },
    { lastSyncId: 0, groups: [] },
  ]);
  expect(pool.ids(card)).toEqual([]);
  expect(pool.snapshot().actor).toEqual(ben);
  expect(reported).toHaveLength(1);
  expect(pushes[0]).toEqual(['id-1']);
  expect(pushes.flat()).not.toContain('t-ana');
});

test('a server that names no actor still opens the pushes, and the copy stays', async () => {
  const pool = anasPool();
  const { pushes } = await run(
    pool,
    () => Stream.concat(Stream.make(opening()), Stream.never),
    (seen) => until(() => seen.pushes.length > 0),
  );
  expect(pushes[0]).toEqual(['t-ana']);
  expect(pool.snapshot().actor).toEqual(ana);
});

test('after a pull ends, the engine pushes nothing until the next pull names the actor', async () => {
  const pool = createPool([], declared, { stamps: testStamps() });
  const second = Effect.runSync(Deferred.make<SyncMessage>());
  const { pushes } = await run(
    pool,
    // The first pull opens the gate, then ends as a dropped socket ends it.
    (index) =>
      index === 0
        ? Stream.make(opening(ana))
        : Stream.concat(Stream.fromEffect(Deferred.await(second)), Stream.never),
    (seen) =>
      Effect.gen(function* () {
        yield* until(() => seen.pulls.length === 2);
        pool.run(archive, { id: 'a' });
        yield* Effect.sleep('300 millis');
        expect(seen.pushes).toEqual([]);
        yield* Deferred.succeed(second, opening(ana));
        yield* until(() => seen.pushes.length > 0);
      }),
  );
  expect(pushes[0]).toEqual(['id-1']);
});
