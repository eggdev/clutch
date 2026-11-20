import { Actors } from '@repo/identity/service/actors';
import type { ServerChange } from '@repo/sync/commands/server-change.server';
import { originAllowed, syncOrigins } from '@repo/sync/config/origins';
import type { Contract } from '@repo/sync/contract/define';
import { manifestOf } from '@repo/sync/contract/manifest';
import { closeAsEnded, SocketEnds, SocketEndsLive } from '@repo/sync/runtime/socket-ends.server';
import { EventLog } from '@repo/sync/service/event-log';
import { feed } from '@repo/sync/service/feed';
import type { LoadRequest } from '@repo/sync/service/feed';
import { Sessions } from '@repo/sync/service/sessions';
import { settle } from '@repo/sync/service/settle';
import { SyncGroups } from '@repo/sync/service/sync-groups';
import { GroupNotAllowed } from '@repo/sync/types/group-not-allowed';
import { SyncRpcs, transactionsPerPush } from '@repo/sync/types/protocol';
import type { Outcome, Transaction } from '@repo/sync/types/protocol';
import { ServerBehind } from '@repo/sync/types/server-behind';
import { SessionEnded } from '@repo/sync/types/session-ended';
import { Deferred, Effect, Layer, Queue, Stream } from 'effect';
import { HttpRouter, HttpServerRequest, HttpServerResponse } from 'effect/http';
import { RpcServer } from 'effect/rpc';
import type { Rpc } from 'effect/rpc';

/** The path of the sync socket on the server app. */
const syncPath = '/sync';

/**
 * An `Actors` layer that finds no session dies with `SessionEnded`. Each
 * other failure stays a server fault, so a client keeps its local database.
 */
const noSession = (defect: unknown) =>
  defect instanceof SessionEnded ? Effect.succeed(null) : Effect.die(defect);

/**
 * Accepts the upgrade of a socket with no session, and closes it at once
 * with code 4401. A browser cannot read the status of a refused upgrade, but
 * it reads the close code, so a client that was offline when its session
 * ended learns it when it connects.
 */
const endedSocket = (request: HttpServerRequest.HttpServerRequest) =>
  Effect.gen(function* () {
    const socket = yield* Effect.orDie(request.upgrade);
    yield* closeAsEnded(yield* socket.writer);
    return HttpServerResponse.empty();
  });

/**
 * The WebSocket protocol of the RPC server, with each socket kept in
 * `Sessions` for its actor. `Sessions.end` can then close the actor's sockets
 * with code 4401. The RPC server upgrades the request itself, so this layer
 * gives it a request whose upgrade also tracks the socket. `SocketEnds`
 * ties each RPC client to its socket, so a call can close it with code 4401
 * too. A request from an origin that `SYNC_ORIGINS` does not list gets 403
 * before the upgrade.
 */
const trackedWebsocket = Layer.effect(RpcServer.Protocol)(
  Effect.gen(function* () {
    const { httpEffect, protocol } = yield* RpcServer.makeProtocolWithHttpEffectWebsocket;
    const router = yield* HttpRouter.HttpRouter;
    const sessions = yield* Sessions;
    const ends = yield* SocketEnds;
    const actors = yield* Actors;
    const origins = yield* syncOrigins;
    yield* router.add('GET', syncPath, (request) => {
      if (!originAllowed(request.headers.origin, origins)) {
        return Effect.succeed(
          HttpServerResponse.text('This origin may not open the sync socket.', { status: 403 }),
        );
      }
      return Effect.gen(function* () {
        const actor = yield* actors
          .fromHeaders(request.headers)
          .pipe(Effect.catchDefect(noSession));
        if (!actor) {
          return yield* endedSocket(request);
        }
        const tracked: HttpServerRequest.HttpServerRequest = Object.create(request, {
          upgrade: {
            value: request.upgrade.pipe(
              Effect.tap((socket) =>
                Effect.andThen(sessions.track(actor.userId, socket), ends.carry(socket)),
              ),
            ),
          },
        });
        return yield* httpEffect.pipe(
          Effect.provideService(HttpServerRequest.HttpServerRequest, tracked),
          ends.serve,
        );
      });
    });
    return ends.protocol(protocol);
  }),
);

/**
 * The sync server: `Push`, `Pull` and `Load` over one WebSocket. `changes`
 * lists the server change of every command, from each package's
 * `runtime/server.server.ts`. The layer needs the services of every
 * change, and the one `EventLog` of the server app. The server app names
 * them with `SyncServer<ServicesOf<typeof serverChanges>>(serverChanges, contracts)`,
 * where `serverOf(packages)` gives both lists.
 * `contracts` lists each contract that the app serves. A command of one of
 * them with no server change stops the server at its start. The actor of each call comes from `Actors`,
 * and the groups it may load come from `SyncGroups`. A server app adds this
 * layer to its router.
 */
export function SyncServer<R>(
  changes: ReadonlyArray<ServerChange<R>>,
  contracts: ReadonlyArray<Contract>,
) {
  const byName = new Map(changes.map((change) => [change.name, change]));
  const manifest = manifestOf(contracts);
  const unserved = manifest.commands.filter((declared) => !byName.has(declared.name));
  const handlers = SyncRpcs.toLayer(
    Effect.gen(function* () {
      // A command that a contract declares and no server change serves would
      // refuse every write of it. The server stops at its start instead.
      if (unserved.length) {
        return yield* Effect.die(
          new Error(
            `The server app passes no server change for: ${unserved.map((declared) => declared.name).join(', ')}. Add the server change of each command to its package's \`runtime/server.server.ts\`.`,
          ),
        );
      }
      const log = yield* EventLog;
      // The services of every server change. The composition root provides
      // them, so a missing service fails the typecheck of the server app.
      const services = yield* Effect.context<R>();
      const actors = yield* Actors;
      const ends = yield* SocketEnds;
      const syncGroups = yield* SyncGroups;
      // The actor of a call on an open socket. When the session ended since
      // the upgrade, the socket closes with code 4401, as at the upgrade, and
      // the call stops. Each other defect stays a server fault.
      const actorOf = (client: Rpc.ServerClient, headers: Readonly<Record<string, string>>) =>
        actors
          .fromHeaders(headers)
          .pipe(
            Effect.catchDefect((defect) =>
              defect instanceof SessionEnded
                ? Effect.andThen(ends.end(client.id), Effect.interrupt)
                : Effect.die(defect),
            ),
          );
      // The `Load` queue of each open `Pull` stream, by RPC client. A `Load`
      // that comes before its `Pull` stream opens waits for the queue.
      const requests = new Map<number, Deferred.Deferred<Queue.Queue<LoadRequest>>>();
      const requestsOf = (id: number) =>
        Effect.gen(function* () {
          const known = requests.get(id);
          if (known) {
            return known;
          }
          const made = yield* Deferred.make<Queue.Queue<LoadRequest>>();
          requests.set(id, made);
          return made;
        });
      const push = (
        transaction: Transaction,
        client: Rpc.ServerClient,
        headers: Readonly<Record<string, string>>,
      ) =>
        Effect.gen(function* () {
          const actor = yield* actorOf(client, headers);
          return yield* settle(byName.get(transaction.command), transaction, actor).pipe(
            Effect.provideContext(services),
            Effect.provideService(EventLog, log),
          );
        });
      return {
        // The outcomes come in the order of the transactions. When the database
        // does not answer, the list ends there: that write and each write
        // behind it get no outcome, so the client keeps them in their order.
        // A client sends at most `transactionsPerPush` in one push. A longer
        // list is refused whole, before any of it runs.
        Push: ({ transactions }, { client, headers }) =>
          Effect.gen(function* () {
            if (transactions.length > transactionsPerPush) {
              return yield* Effect.die(
                new Error(
                  `A push holds ${transactions.length} transactions. The server takes at most ${transactionsPerPush}.`,
                ),
              );
            }
            const outcomes: Array<Outcome> = [];
            for (const transaction of transactions) {
              const outcome = yield* push(transaction, client, headers).pipe(
                Effect.catchTag('ServerUnavailable', () => Effect.void),
              );
              if (!outcome) {
                yield* Effect.logWarning('The database did not answer, so a push stopped');
                break;
              }
              outcomes.push(outcome);
            }
            return outcomes;
          }),
        // After a database restore, the log can end before the client's last
        // sync ID. After a trim, it can start after it. The client then loads
        // again from 0.
        Pull: ({ lastSyncId, groups, contract, pages }, { client, headers }) =>
          Stream.unwrap(
            Effect.gen(function* () {
              const actor = yield* actorOf(client, headers);
              // A build of another contract still syncs. The line names it,
              // so the traffic of each older build can be counted by digest.
              if (contract !== manifest.digest) {
                yield* Effect.logInfo('A client of another contract connected').pipe(
                  Effect.annotateLogs({ client: contract ?? 'unknown', server: manifest.digest }),
                );
              }
              const head = yield* log.head(actor.organizationId).pipe(Effect.orDie);
              if (lastSyncId > head) {
                return yield* new ServerBehind({ head });
              }
              const granted = syncGroups.groupsFor(actor);
              const allowed = yield* granted.pipe(Effect.orDie);
              const queue = yield* Queue.unbounded<LoadRequest>();
              yield* Deferred.succeed(yield* requestsOf(client.id), queue);
              return feed(log, {
                organizationId: actor.organizationId,
                userId: actor.userId,
                lastSyncId,
                loaded: [
                  ...allowed.eager,
                  ...groups.filter((group) => allowed.lazy.includes(group)),
                ],
                // A client that holds data and did not name an eager group,
                // such as a new one, lacks its records. It gets their snapshot.
                fill:
                  lastSyncId > 0 ? allowed.eager.filter((group) => !groups.includes(group)) : [],
                pages: pages ?? false,
                granted,
                requests: queue,
              }).pipe(
                // `ServerBehind` reaches the client. Any other failure is a defect.
                Stream.catchIf(
                  (error): error is ServerBehind => error instanceof ServerBehind,
                  (behind) => Stream.fail(behind),
                  (other) => Stream.die(other),
                ),
                Stream.ensuring(Effect.sync(() => requests.delete(client.id))),
              );
            }),
          ),
        Load: ({ group, pages }, { client, headers }) =>
          Effect.gen(function* () {
            const actor = yield* actorOf(client, headers);
            const allowed = yield* syncGroups.groupsFor(actor).pipe(Effect.orDie);
            if (![...allowed.eager, ...allowed.lazy].includes(group)) {
              return yield* new GroupNotAllowed({ group });
            }
            const queue = yield* Deferred.await(yield* requestsOf(client.id));
            yield* Queue.offer(queue, { group, pages: pages ?? false });
          }),
      };
    }),
  );
  // The server app provides one `EventLog` for the sync server, the job
  // runner and the routes, so a commit from any of them reaches each client.
  // `trackedWebsocket` and the handlers share one `SocketEnds`.
  return RpcServer.layer(SyncRpcs).pipe(
    Layer.provide(trackedWebsocket),
    Layer.provide(handlers),
    Layer.provide(SocketEndsLive),
  );
}
