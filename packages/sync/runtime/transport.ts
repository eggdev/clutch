import type { Contract } from '@repo/sync/contract/define';
import { manifestOf } from '@repo/sync/contract/manifest';
import type { Pool } from '@repo/sync/runtime/pool';
import { SyncRpcs } from '@repo/sync/types/protocol';
import { sessionEndedCode } from '@repo/sync/types/session-ended';
import { Effect, Layer, Queue, Schedule, Stream } from 'effect';
import { RpcClient, RpcSerialization } from 'effect/rpc';
import type { RpcClientError } from 'effect/rpc/RpcClientError';
import { Socket } from 'effect/socket';

/**
 * The network side of the sync engine. It loads after the first paint, in its
 * own chunk, because it holds the Effect code. One socket carries three calls:
 * `Pull` streams messages from the last sync ID for the loaded groups, `Push`
 * sends the transactions that wait, in batches, and `Load` asks for a group
 * that a gate needs.
 */
/** The headers that a native app sends when it opens the socket. */
type SocketHeaders = Readonly<Record<string, string>>;

/**
 * The WebSocket of the platform, watched for the close code of an ended
 * session. The server closes each socket of a signed-out user with code 4401.
 *
 * A browser sends its cookies and can set no header. The WebSocket of React
 * Native takes headers as a third argument, which the type of the browser
 * does not list, so `Reflect.construct` passes it.
 */
function watchedWebSocket(onSessionEnded: () => void, headers?: SocketHeaders) {
  return Layer.succeed(Socket.WebSocketConstructor)((url, options) => {
    const protocols = typeof options === 'string' || Array.isArray(options) ? options : undefined;
    const socket: WebSocket = headers
      ? Reflect.construct(WebSocket, [url, protocols, { headers }])
      : new WebSocket(url, protocols);
    socket.addEventListener('close', (event) => {
      if (event.code === sessionEndedCode) {
        onSessionEnded();
      }
    });
    return socket;
  });
}

function protocol(url: string, onSessionEnded: () => void, headers?: SocketHeaders) {
  return RpcClient.layerProtocolSocket({ retryTransientErrors: true }).pipe(
    Layer.provide(Socket.layerWebSocket(url)),
    Layer.provide(watchedWebSocket(onSessionEnded, headers)),
    Layer.provide(RpcSerialization.layerJson),
  );
}

/** Each group that a gate asks for, starting with the ones asked for before the socket opened. */
/**
 * How long a push waits before it tries again: 200 ms, then twice as long each
 * time, and never more than 3 seconds. Without the limit, a device that was
 * offline for a while would wait as long again before it sends what it holds.
 */
const pushRetry = Schedule.min([Schedule.exponential('200 millis'), Schedule.spaced('3 seconds')]);

function loadRequests(pool: Pool) {
  return Stream.callback<string>((queue) =>
    Effect.acquireRelease(
      Effect.sync(() => {
        for (const group of pool.requestedGroups()) {
          Queue.offerUnsafe(queue, group);
        }
        return pool.onLoadRequest((group) => Queue.offerUnsafe(queue, group));
      }),
      (unsubscribe) => Effect.sync(unsubscribe),
    ),
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

/**
 * The work of one connection, over a client of the sync calls. It is apart
 * from the socket, so `transport.test.ts` runs it against handlers in memory.
 */
export function engine(
  pool: Pool,
  client: RpcClient.FromGroup<typeof SyncRpcs, RpcClientError>,
  contract: string,
  onSessionEnded: () => void,
) {
  return Effect.gen(function* () {
    // A copy that another build left a record out of loads again from 0, before the first pull.
    pool.nameBuild(contract);
    const pull = Effect.suspend(() =>
      client
        .Pull({ lastSyncId: pool.lastSyncId(), groups: pool.loadedGroups(), contract })
        .pipe(
          Stream.runForEach((message) =>
            Effect.sync(() =>
              message._tag === 'Deltas'
                ? pool.applyDeltas(message.deltas)
                : pool.applyGroups(message.loaded, message.backfill),
            ),
          ),
        ),
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
      // The server gives no outcome for a write that it could not try, because
      // its database did not answer. Those writes stay queued and go again.
      const unanswered = ids.filter(
        (id) => !outcomes.some((outcome) => outcome.transactionId === id),
      );
      if (unanswered.length > 0) {
        pool.markSent(unanswered, false);
        return yield* Effect.fail('The server did not try each write');
      }
    });
    // A group that the actor may not load is refused: its gate stops waiting,
    // and the pool reports it. After any other failure the request stays, and
    // the next connection asks again.
    yield* loadRequests(pool).pipe(
      Stream.runForEach((group) =>
        client.Load({ group }).pipe(
          Effect.catchTag('GroupNotAllowed', () => Effect.sync(() => pool.refuseGroup(group))),
          Effect.ignore,
        ),
      ),
      Effect.forkScoped,
    );
    yield* pendingSignals(pool).pipe(
      Stream.runForEach(() => push.pipe(Effect.retry(pushRetry), Effect.ignore)),
    );
  });
}

function session(pool: Pool, contract: string, onSessionEnded: () => void) {
  return Effect.gen(function* () {
    const client = yield* RpcClient.make(SyncRpcs);
    yield* engine(pool, client, contract, onSessionEnded);
  }).pipe(Effect.scoped);
}

/**
 * Connects the pool to the server. The socket reconnects on its own after a
 * drop. Each `Pull` names the digest of the app's contracts, so the server
 * knows which build it talks to.
 */
export function connect(
  pool: Pool,
  options: {
    readonly url: string;
    readonly onSessionEnded: () => void;
    readonly contracts: ReadonlyArray<Contract>;
    /** A native app names its actor here. A browser leaves it out and sends its cookies. */
    readonly headers?: SocketHeaders;
  },
) {
  const contract = manifestOf(options.contracts).digest;
  return Effect.runFork(
    session(pool, contract, options.onSessionEnded).pipe(
      Effect.provide(protocol(options.url, options.onSessionEnded, options.headers)),
    ),
  );
}
