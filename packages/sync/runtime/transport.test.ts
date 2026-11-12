import { expect, test } from 'bun:test';

import { createPool } from '@repo/sync/runtime/pool';
import type { Pool } from '@repo/sync/runtime/pool';
import { engine } from '@repo/sync/runtime/transport';
import { testCommand, testModel, testStamps } from '@repo/sync/testing/pool-state';
import { GroupNotAllowed } from '@repo/sync/types/group-not-allowed';
import { SyncRpcs } from '@repo/sync/types/protocol';
import type { Outcome, Transaction } from '@repo/sync/types/protocol';
import { Effect, Schedule, Stream } from 'effect';
import { RpcTest } from 'effect/rpc';

const card = testModel('Card', { id: 'string', title: 'string' });
const archive = testCommand('cards/archive', { id: 'string' }, 'server');
const declared = { records: [card], commands: [archive] };

type Server = {
  readonly push: (transactions: ReadonlyArray<Transaction>) => ReadonlyArray<Outcome>;
  readonly allows: (group: string) => boolean;
};

function sessionStays() {
  // No test ends the session.
}

/** Runs the engine of one connection against a server in memory, until `done` holds. */
function connected(pool: Pool, server: Server, done: () => boolean) {
  const handlers = SyncRpcs.toLayer({
    Push: ({ transactions }) => Effect.sync(() => server.push(transactions)),
    Pull: () => Stream.never,
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
