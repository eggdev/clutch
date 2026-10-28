import type { Pool } from '@repo/sync/runtime/pool';
import { SyncRpcs } from '@repo/sync/types/protocol';
import { sessionEndedCode } from '@repo/sync/types/session-ended';
import { Effect, Layer, Queue, Schedule, Stream } from 'effect';
import { RpcClient, RpcSerialization } from 'effect/rpc';
import { Socket } from 'effect/socket';

/**
 * The network side of the sync engine. It loads after the first paint, in its
 * own chunk, because it holds the Effect code. One socket carries both calls:
 * `Pull` streams deltas from the last sync ID, and `Push` sends the
 * transactions that wait, in batches.
 */
/**
 * The browser WebSocket, watched for the close code of an ended session. The
 * server closes each socket of a signed-out user with code 4401.
 */
function watchedWebSocket(onSessionEnded: () => void) {
  return Layer.succeed(Socket.WebSocketConstructor)((url, options) => {
    const socket = new WebSocket(
      url,
      typeof options === 'string' || Array.isArray(options) ? options : undefined,
    );
    socket.addEventListener('close', (event) => {
      if (event.code === sessionEndedCode) {
        onSessionEnded();
      }
    });
    return socket;
  });
}

function protocol(url: string, onSessionEnded: () => void) {
  return RpcClient.layerProtocolSocket({ retryTransientErrors: true }).pipe(
    Layer.provide(Socket.layerWebSocket(url)),
    Layer.provide(watchedWebSocket(onSessionEnded)),
    Layer.provide(RpcSerialization.layerJson),
  );
}

/** One signal each time the pool has new transactions to send. */
function pendingSignals(pool: Pool) {
  return Stream.callback<true>((queue) =>
    Effect.acquireRelease(
      Effect.sync(() => {
        Queue.offerUnsafe(queue, true);
        return pool.onPending(() => Queue.offerUnsafe(queue, true));
      }),
      (unsubscribe) => Effect.sync(unsubscribe),
    ),
  );
}

function session(pool: Pool, onSessionEnded: () => void) {
  return Effect.gen(function* () {
    const client = yield* RpcClient.make(SyncRpcs);
    const pull = Effect.suspend(() =>
      client
        .Pull({ lastSyncId: pool.lastSyncId() })
        .pipe(Stream.runForEach((deltas) => Effect.sync(() => pool.applyDeltas(deltas)))),
    );
    // After a database restore, the server's log ends before our last sync
    // ID. Drop the confirmed records, keep the pending transactions, and
    // load again from 0.
    yield* pull.pipe(
      Effect.catchTag('ServerBehind', () =>
        Effect.sync(() => pool.resetConfirmed()).pipe(Effect.andThen(pull)),
      ),
      Effect.catchTag('SessionEnded', () => Effect.sync(onSessionEnded)),
      Effect.forkScoped,
    );
    const push = Effect.gen(function* () {
      const batch = pool.unsent();
      if (batch.length === 0) {
        return;
      }
      const ids = batch.map((transaction) => transaction.id);
      pool.markSent(ids, true);
      const outcomes = yield* client
        .Push({ transactions: batch })
        .pipe(Effect.tapError(() => Effect.sync(() => pool.markSent(ids, false))));
      pool.settle(outcomes);
    });
    yield* pendingSignals(pool).pipe(
      Stream.runForEach(() =>
        push.pipe(Effect.retry(Schedule.exponential('200 millis')), Effect.ignore),
      ),
    );
  }).pipe(Effect.scoped);
}

/** Connects the pool to the server. The socket reconnects on its own after a drop. */
export function connect(
  pool: Pool,
  options: { readonly url: string; readonly onSessionEnded: () => void },
) {
  return Effect.runFork(
    session(pool, options.onSessionEnded).pipe(
      Effect.provide(protocol(options.url, options.onSessionEnded)),
    ),
  );
}
