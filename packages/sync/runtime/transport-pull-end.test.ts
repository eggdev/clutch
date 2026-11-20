import { expect, test } from 'bun:test';

import { createPool } from '@repo/sync/runtime/pool';
import type { Pool } from '@repo/sync/runtime/pool';
import { engine } from '@repo/sync/runtime/transport';
import { testModel, testStamps } from '@repo/sync/testing/pool-state';
import { SyncRpcs } from '@repo/sync/types/protocol';
import type { SyncActor, SyncMessage } from '@repo/sync/types/protocol';
import { ServerBehind } from '@repo/sync/types/server-behind';
import { SessionEnded, sessionEndedCode } from '@repo/sync/types/session-ended';
import { Effect, Schedule, Stream } from 'effect';
import { RpcClient, RpcServer } from 'effect/rpc';
import type { RpcGroup } from 'effect/rpc';
import { RpcClientError } from 'effect/rpc/RpcClientError';
import type { FromServer } from 'effect/rpc/RpcMessage';
import { Socket } from 'effect/socket';

/**
 * The engine tells the pool when each pull ends, however it ends, so a load
 * that did not finish leaves no record. Each pull here ends in another way.
 */

const card = testModel('Card', { id: 'string', title: 'string' });
const declared = { records: [card], commands: [] };

const ada: SyncActor = { userId: 'ada', organizationId: 'acme' };
const bea: SyncActor = { userId: 'bea', organizationId: 'acme' };

const named = (actor: SyncActor): SyncMessage => ({
  _tag: 'Groups',
  loaded: [],
  backfill: [],
  actor,
});

type Rpcs = RpcGroup.Rpcs<typeof SyncRpcs>;

/**
 * A client of the sync calls over handlers in memory, as `RpcTest` makes
 * one, whose socket can drop. After `drop`, the next message that the client
 * sends fails with the error of a socket that could not be written, as the
 * socket protocol fails it. A stream sends one such message, its `Ack`, after
 * each chunk, so the open pull fails as a dropped socket fails it.
 */
const droppableClient = (socket: { dropping: boolean }) =>
  Effect.gen(function* () {
    const holder: { write?: (message: FromServer<Rpcs>) => Effect.Effect<void> } = {};
    const server = yield* RpcServer.makeNoSerialization(SyncRpcs, {
      onFromServer: (response) => holder.write?.(response) ?? Effect.void,
    });
    const made = yield* RpcClient.makeNoSerialization<Rpcs, RpcClientError>(SyncRpcs, {
      supportsAck: true,
      onFromClient: ({ message }) => {
        if (!socket.dropping) {
          return server.write(0, message);
        }
        socket.dropping = false;
        const reason = new Socket.SocketWriteError({
          cause: 'The socket dropped.',
        });
        return Effect.fail(new RpcClientError({ reason }));
      },
    });
    holder.write = made.write;
    return made.client;
  });

function sessionStays() {
  // The engine stops on its own after the pull that ends the session.
}

test('the engine tells the pool at the end of each pull, however the pull ended', async () => {
  const lines: Array<string> = [];
  const pool = createPool([], declared, {
    stamps: testStamps(),
    report: (line) => lines.push(line),
  });
  const events: Array<string> = [];
  const watched: Pool = {
    ...pool,
    endPull() {
      events.push('end');
      pool.endPull();
    },
  };
  const socket = { dropping: false };
  let pulls = 0;
  const handlers = SyncRpcs.toLayer({
    Push: () => Effect.succeed([]),
    Load: () => Effect.void,
    Pull: () => {
      pulls += 1;
      events.push(`pull ${pulls}`);
      switch (pulls) {
        case 1: {
          // The socket drops before the client acknowledges the first message.
          socket.dropping = true;
          return Stream.concat(Stream.make(named(ada)), Stream.never);
        }
        case 2: {
          return Stream.concat(Stream.make(named(ada)), Stream.fail(new ServerBehind({ head: 0 })));
        }
        case 3: {
          return Stream.concat(Stream.make(named(ada)), Stream.die('A defect of the server.'));
        }
        case 4: {
          // Another actor: the pool drops its copy, and the engine pulls again from 0.
          return Stream.make(named(bea));
        }
        default: {
          return Stream.fail(new SessionEnded({ code: sessionEndedCode }));
        }
      }
    },
  });
  await Effect.runPromise(
    Effect.gen(function* () {
      const client = yield* droppableClient(socket);
      yield* Effect.forkScoped(engine(watched, client, 'digest', sessionStays));
      yield* Effect.suspend(() => (pulls >= 5 ? Effect.void : Effect.fail('not yet'))).pipe(
        Effect.retry(Schedule.spaced('10 millis')),
        Effect.timeout('5 seconds'),
      );
      // The engine pulls no more after the session ended.
      yield* Effect.sleep('400 millis');
    }).pipe(Effect.scoped, Effect.provide(handlers)),
  );
  expect(events).toEqual([
    'pull 1',
    'end',
    'pull 2',
    'end',
    'pull 3',
    'end',
    'pull 4',
    'end',
    'pull 5',
    'end',
  ]);
  expect(lines).toHaveLength(1);
});
