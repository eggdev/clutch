import type { Contract } from '@repo/sync/contract/define';
import { manifestOf } from '@repo/sync/contract/manifest';
import type { Pool } from '@repo/sync/runtime/pool';
import { SyncRpcs, transactionsPerPush } from '@repo/sync/types/protocol';
import type { SyncMessage } from '@repo/sync/types/protocol';
import { sessionEndedCode } from '@repo/sync/types/session-ended';
import { Data, Deferred, Effect, Fiber, Latch, Layer, Queue, Schedule, Stream } from 'effect';
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

/**
 * How long a push or a pull waits before it tries again: 200 ms, then twice
 * as long each time, and never more than 3 seconds. Without the limit, a
 * device that was offline for a while would wait as long again before it
 * sends what it holds. Each wait is moved by a random part of up to a fifth,
 * so the clients of a server that comes back do not all pull at once. The
 * wait is a guess at when the server can take the pull again; CL-921 is the
 * root fix, in which the server says when.
 */
const retryWait = Schedule.min([
  Schedule.exponential('200 millis'),
  Schedule.spaced('3 seconds'),
]).pipe(Schedule.jittered);

/** The wait after a pull that heard the server: the shortest one, with its random part. */
const firstWait = Schedule.spaced('200 millis').pipe(Schedule.jittered);

/** How one pull ended: it heard the server, it heard nothing, or the session ended. */
type PullEnd = 'heard' | 'silent' | 'ended';

/** Each group that a gate asks for, starting with the ones asked for and not loaded yet. */
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

/** Applies one message of a pull to the pool. */
function applyMessage(pool: Pool, message: SyncMessage) {
  switch (message._tag) {
    case 'Deltas': {
      return pool.applyDeltas(message.deltas);
    }
    case 'Page': {
      return pool.applyPage(message.group, message.backfill);
    }
    case 'Groups': {
      return pool.applyGroups(message.loaded, message.backfill);
    }
  }
}

/** The first `Groups` message of a pull named another actor, so the pool dropped its copy. */
class ActorChanged extends Data.TaggedError('ActorChanged') {}

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
    // No push goes on a connection before the first `Groups` message of its
    // pull confirmed the actor. Otherwise the waiting transactions of the
    // last person on the device could go as the new one. A copy of another
    // actor is dropped, and the engine pulls again from 0: the rest of this
    // pull would land on the old position. A server that names no actor
    // opens the gate too, and the copy stays.
    const actorKnown = Latch.makeUnsafe(false);
    // The last pull got its first `Groups` message.
    let heard = false;
    const pull = Effect.suspend(() => {
      let first = true;
      heard = false;
      return client
        .Pull({
          lastSyncId: pool.lastSyncId(),
          groups: pool.loadedGroups(),
          contract,
          pages: true,
        })
        .pipe(
          Stream.runForEach((message) => {
            if (!first || message._tag !== 'Groups') {
              return Effect.sync(() => applyMessage(pool, message));
            }
            first = false;
            heard = true;
            if (!pool.confirmActor(message.actor)) {
              return Effect.fail(new ActorChanged());
            }
            applyMessage(pool, message);
            return actorKnown.open;
          }),
          Effect.ensuring(actorKnown.close),
        );
    });
    // A group that the actor may not load is refused: its gate stops waiting,
    // and the pool reports it. After any other end of a load, also when the
    // server could not run it, the request stays and the next pull asks
    // again. A load never ends the pull that it belongs to.
    const loads = loadRequests(pool).pipe(
      Stream.runForEach((group) =>
        client.Load({ group, pages: true }).pipe(
          Effect.catchTag('GroupNotAllowed', () => Effect.sync(() => pool.refuseGroup(group))),
          Effect.ignoreCause,
        ),
      ),
    );
    // One pull, with the load requests that belong to it. It gives `true`
    // when the engine must pull again. A pull ends when the socket drops or
    // when the server cannot read its log, and the socket then opens again on
    // its own. The next pull names the last sync ID and the loaded groups
    // that the pool holds then, so the client gets each event that it missed.
    // After a database restore, the server's log ends before our last sync
    // ID: drop the confirmed records, keep the pending transactions, and pull
    // again from 0. Only an ended session is final: `untilSessionEnded` then
    // stops the whole engine.
    const again = (): PullEnd => (heard ? 'heard' : 'silent');
    const pullOnce = pull.pipe(
      Effect.raceFirst(loads),
      // However the pull ended, the pool hears it, so a load that it cut off leaves no record.
      Effect.ensuring(Effect.sync(() => pool.endPull())),
      Effect.map(again),
      Effect.catchTag('ActorChanged', () => Effect.sync(again)),
      Effect.catchTag('ServerBehind', () =>
        Effect.sync(() => {
          pool.resetConfirmed();
          return again();
        }),
      ),
      Effect.catchTag('SessionEnded', () =>
        Effect.sync((): PullEnd => {
          onSessionEnded();
          return 'ended';
        }),
      ),
      Effect.catchCause(() => Effect.sync(again)),
    );
    // The wait grows while pulls hear nothing. After a pull that heard the
    // server, it starts again from its shortest.
    yield* pullOnce.pipe(
      Effect.repeat({ while: (end) => end === 'silent', schedule: retryWait }),
      Effect.repeat({ while: (end) => end === 'heard', schedule: firstWait }),
      Effect.forkScoped,
    );
    // One push holds at most `transactionsPerPush` transactions, in their
    // order. The rest go in the next push, straight after this one.
    const pushBatch = Effect.gen(function* () {
      yield* actorKnown.await;
      const batch = pool.unsent().slice(0, transactionsPerPush);
      if (batch.length === 0) {
        return false;
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
      return true;
    });
    const push = pushBatch.pipe(Effect.repeat({ while: (sent) => sent }));
    yield* pendingSignals(pool).pipe(
      Stream.runForEach(() => push.pipe(Effect.retry(retryWait), Effect.ignore)),
    );
  });
}

/**
 * Runs the work of one connection until its session ends. The server ends a
 * session in two ways: it closes the socket with code 4401, or `Pull` fails
 * with `SessionEnded`. `end` tells the app once, and the work stops. The
 * engine of an ended session then pulls and pushes no more, also when its
 * socket could open again.
 */
export function untilSessionEnded<E, R>(
  onSessionEnded: () => void,
  work: (end: () => void) => Effect.Effect<unknown, E, R>,
): Effect.Effect<void, E, R> {
  return Effect.suspend(() => {
    const ended = Deferred.makeUnsafe<null>();
    const end = () => {
      if (Deferred.doneUnsafe(ended, Effect.succeed(null))) {
        onSessionEnded();
      }
    };
    return work(end).pipe(Effect.raceFirst(Deferred.await(ended)), Effect.asVoid);
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
 * drop, and the engine then pulls again. An ended session stops the engine
 * and closes the socket. Each `Pull` names the digest of the app's contracts,
 * so the server knows which build it talks to. It returns the stop of the
 * engine, which closes the socket too.
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
): () => void {
  const contract = manifestOf(options.contracts).digest;
  const fiber = Effect.runFork(
    untilSessionEnded(options.onSessionEnded, (end) =>
      session(pool, contract, end).pipe(
        Effect.provide(protocol(options.url, end, options.headers)),
      ),
    ),
  );
  return () => {
    Effect.runFork(Fiber.interrupt(fiber));
  };
}
