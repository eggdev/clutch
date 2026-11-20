import { expect, test } from 'bun:test';

import { createPool } from '@repo/sync/runtime/pool';
import type { Pool } from '@repo/sync/runtime/pool';
import { engine, untilSessionEnded } from '@repo/sync/runtime/transport';
import { testCommand, testModel, testStamps } from '@repo/sync/testing/pool-state';
import { GroupNotAllowed } from '@repo/sync/types/group-not-allowed';
import { SyncRpcs } from '@repo/sync/types/protocol';
import type { Outcome, SyncMessage, Transaction } from '@repo/sync/types/protocol';
import { SessionEnded } from '@repo/sync/types/session-ended';
import { Effect, Schedule, Stream } from 'effect';
import { RpcTest } from 'effect/rpc';

const card = testModel('Card', { id: 'string', title: 'string' });
const archive = testCommand('cards/archive', { id: 'string' }, 'server');
const declared = { records: [card], commands: [archive] };

type PullCall = { readonly lastSyncId: number; readonly groups: ReadonlyArray<string> };

type Server = {
  readonly push: (transactions: ReadonlyArray<Transaction>) => ReadonlyArray<Outcome>;
  readonly allows: (group: string) => boolean;
  /**
   * The messages of one pull. Without it, a pull sends the loaded groups,
   * which open the pushes, then stays open.
   */
  readonly pull?: (call: PullCall) => Stream.Stream<SyncMessage, SessionEnded>;
};

function sessionStays() {
  // No test ends the session.
}

/** Runs the engine of one connection against a server in memory, until `done` holds. */
function connected(pool: Pool, server: Server, done: () => boolean) {
  const handlers = SyncRpcs.toLayer({
    Push: ({ transactions }) => Effect.sync(() => server.push(transactions)),
    Pull: (call) =>
      server.pull?.(call) ??
      Stream.concat(
        Stream.make<Array<SyncMessage>>({ _tag: 'Groups', loaded: [], backfill: [] }),
        Stream.never,
      ),
    Load: ({ group }) => (server.allows(group) ? Effect.void : new GroupNotAllowed({ group })),
  });
  const waitUntilDone = Effect.suspend(() => (done() ? Effect.void : Effect.fail('not yet'))).pipe(
    Effect.retry(Schedule.spaced('10 millis')),
    Effect.timeout('5 seconds'),
  );
  return Effect.runPromise(
    Effect.gen(function* () {
      const client = yield* RpcTest.makeClient(SyncRpcs);
      yield* Effect.forkScoped(engine(pool, client, 'digest', sessionStays));
      yield* waitUntilDone;
    }).pipe(Effect.scoped, Effect.provide(handlers)),
  );
}

test('a write that the server could not try stays queued and goes again', async () => {
  const pool = createPool([], declared, { stamps: testStamps() });
  const id = pool.run(archive, { id: 'a' });
  const pushes: Array<ReadonlyArray<string>> = [];
  await connected(
    pool,
    {
      // The database does not answer the first push, so the server gives no outcome.
      push: (transactions) => {
        pushes.push(transactions.map((transaction) => transaction.id));
        return pushes.length === 1
          ? []
          : transactions.map((transaction) => ({
              transactionId: transaction.id,
              status: 'accepted' as const,
              syncId: 1,
              reason: null,
              code: null,
            }));
      },
      allows: () => true,
    },
    () => pushes.length === 2,
  );
  expect(pushes).toEqual([[id], [id]]);
  expect(pool.isPending(id)).toBe(true);
  expect(pool.unsent()).toEqual([]);
  expect(pool.lastRejection()).toBeUndefined();
});

test('a group that the server refuses ends its gate as refused, and the pool reports it', async () => {
  const lines: Array<string> = [];
  const pool = createPool([], declared, { report: (line) => lines.push(line) });
  let loaded: boolean | undefined;
  const gate = pool.loadGroup('space:x').then((result) => {
    loaded = result;
  });
  await connected(pool, { push: () => [], allows: () => false }, () => loaded !== undefined);
  await gate;
  expect(loaded).toBe(false);
  expect(pool.requestedGroups()).toEqual([]);
  expect(lines).toEqual([
    'The server refused to load space:x for this account, so its screen shows no records.',
  ]);
});

test('after a pull ends, the engine pulls again from the last sync ID of the pool', async () => {
  const pool = createPool([], declared, { stamps: testStamps() });
  const pulls: Array<PullCall> = [];
  await connected(
    pool,
    {
      push: () => [],
      allows: () => true,
      // The first pull sends one event, then ends as a dropped socket ends it.
      pull: (call) => {
        pulls.push({ lastSyncId: call.lastSyncId, groups: call.groups });
        return pulls.length === 1
          ? Stream.concat(
              Stream.make<Array<SyncMessage>>(
                { _tag: 'Groups', loaded: ['org:acme'], backfill: [] },
                {
                  _tag: 'Deltas',
                  deltas: [
                    {
                      syncId: 7,
                      transactionId: null,
                      changes: [
                        {
                          model: 'Card',
                          id: 'a',
                          action: 'upsert',
                          data: { id: 'a', title: 'Live' },
                          groups: ['org:acme'],
                        },
                      ],
                    },
                  ],
                },
              ),
              Stream.die('The socket dropped.'),
            )
          : Stream.never;
      },
    },
    () => pulls.length === 2,
  );
  expect(pool.get(card, 'a')?.title).toBe('Live');
  expect(pulls).toEqual([
    { lastSyncId: 0, groups: [] },
    { lastSyncId: 7, groups: ['org:acme'] },
  ]);
});

test('a group that a gate asked for is asked for again by the next pull', async () => {
  const pool = createPool([], declared, { stamps: testStamps() });
  const asked: Array<string> = [];
  let pulls = 0;
  void pool.loadGroup('space:x');
  await connected(
    pool,
    {
      push: () => [],
      // The server takes each request and loads nothing, as when the socket drops first.
      allows: (group) => {
        asked.push(group);
        return true;
      },
      // The first pull stays open until the request arrives, then ends.
      pull: () => {
        pulls += 1;
        return pulls === 1
          ? Stream.unwrap(
              Effect.suspend(() => (asked.length ? Effect.void : Effect.fail('not yet'))).pipe(
                Effect.retry(Schedule.spaced('5 millis')),
                Effect.orDie,
                Effect.as(Stream.die('The socket dropped.')),
              ),
            )
          : Stream.never;
      },
    },
    () => asked.length === 2,
  );
  expect(asked).toEqual(['space:x', 'space:x']);
});

test('an ended session ends the pulls', async () => {
  const pool = createPool([], declared, { stamps: testStamps() });
  let pulls = 0;
  let ended = 0;
  const handlers = SyncRpcs.toLayer({
    Push: () => Effect.succeed([]),
    Pull: () => {
      pulls += 1;
      return Stream.fail(new SessionEnded({ code: 4401 }));
    },
    Load: () => Effect.void,
  });
  await Effect.runPromise(
    Effect.gen(function* () {
      const client = yield* RpcTest.makeClient(SyncRpcs);
      yield* Effect.forkScoped(
        engine(pool, client, 'digest', () => {
          ended += 1;
        }),
      );
      // Longer than the first two waits of a pull that tries again.
      yield* Effect.sleep('700 millis');
    }).pipe(Effect.scoped, Effect.provide(handlers)),
  );
  expect(ended).toBe(1);
  expect(pulls).toBe(1);
});

test('a socket that the server closes for an ended session stops the engine', async () => {
  const pool = createPool([], declared, { stamps: testStamps() });
  let pulls = 0;
  let ended = 0;
  // The close listener of the socket calls this, then the open pull fails.
  let close: (() => void) | undefined;
  const handlers = SyncRpcs.toLayer({
    Push: () => Effect.succeed([]),
    Pull: () => {
      pulls += 1;
      close?.();
      return Stream.die('The server closed the socket with code 4401.');
    },
    Load: () => Effect.void,
  });
  // The work ends by itself, so the engine pulls and pushes no more.
  await Effect.runPromise(
    Effect.gen(function* () {
      const client = yield* RpcTest.makeClient(SyncRpcs);
      yield* untilSessionEnded(
        () => {
          ended += 1;
        },
        (end) => {
          close = end;
          return engine(pool, client, 'digest', end);
        },
      );
    }).pipe(Effect.scoped, Effect.provide(handlers), Effect.timeout('5 seconds')),
  );
  // A second close of the same session tells the app nothing more.
  close?.();
  expect(ended).toBe(1);
  expect(pulls).toBe(1);
});

test('a pull that fails with an ended session stops the pushes too', async () => {
  const pool = createPool([], declared, { stamps: testStamps() });
  let pulls = 0;
  let pushes = 0;
  let ended = 0;
  const handlers = SyncRpcs.toLayer({
    Push: () => {
      pushes += 1;
      return Effect.succeed([]);
    },
    Pull: () => {
      pulls += 1;
      return Stream.fail(new SessionEnded({ code: 4401 }));
    },
    Load: () => Effect.void,
  });
  await Effect.runPromise(
    Effect.gen(function* () {
      const client = yield* RpcTest.makeClient(SyncRpcs);
      yield* untilSessionEnded(
        () => {
          ended += 1;
        },
        (end) => engine(pool, client, 'digest', end),
      );
      // A write of the person after the end stays on the device.
      pool.run(archive, { id: 'a' });
      yield* Effect.sleep('300 millis');
    }).pipe(Effect.scoped, Effect.provide(handlers), Effect.timeout('5 seconds')),
  );
  expect(ended).toBe(1);
  expect(pulls).toBe(1);
  expect(pushes).toBe(0);
  expect(pool.unsent()).toHaveLength(1);
});

test('a queue of more transactions than one push holds goes in more than one push, in order', async () => {
  const pool = createPool([], declared, { stamps: testStamps() });
  const ids = Array.from({ length: 250 }, (_, index) => pool.run(archive, { id: `c${index}` }));
  const pushes: Array<ReadonlyArray<string>> = [];
  await connected(
    pool,
    {
      push: (transactions) => {
        pushes.push(transactions.map((transaction) => transaction.id));
        return transactions.map((transaction) => ({
          transactionId: transaction.id,
          status: 'accepted' as const,
          syncId: 1,
          reason: null,
          code: null,
        }));
      },
      allows: () => true,
    },
    () => pushes.flat().length === 250,
  );
  expect(pushes.map((batch) => batch.length)).toEqual([100, 100, 50]);
  expect(pushes.flat()).toEqual(ids);
});

test('after a pull that heard the server, the wait before the next pull starts again from its shortest', async () => {
  const pool = createPool([], declared, { stamps: testStamps() });
  const starts: Array<number> = [];
  await connected(
    pool,
    {
      push: () => [],
      allows: () => true,
      // Four pulls fail with no message, so the wait grows. The fifth hears
      // the server, then its socket drops.
      pull: () => {
        starts.push(performance.now());
        if (starts.length < 5) {
          return Stream.die('The server is down.');
        }
        return starts.length === 5
          ? Stream.concat(
              Stream.make<Array<SyncMessage>>({ _tag: 'Groups', loaded: [], backfill: [] }),
              Stream.die('The socket dropped.'),
            )
          : Stream.never;
      },
    },
    () => starts.length === 6,
  );
  const waits = starts.slice(1).map((start, index) => start - (starts[index] ?? 0));
  // The waits grow from 200 ms, each with a random part of up to a fifth.
  expect(waits[3]).toBeGreaterThan(1000);
  // After the pull that heard the server, the wait is near 200 ms again.
  expect(waits[4]).toBeLessThan(600);
});
