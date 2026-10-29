import { Actors } from '@repo/identity/service/actors';
import type { ServerChange } from '@repo/sync/commands/define.server';
import { originAllowed, syncOrigins } from '@repo/sync/config/origins';
import { EventLog } from '@repo/sync/service/event-log';
import { feed } from '@repo/sync/service/feed';
import { Sessions } from '@repo/sync/service/sessions';
import { SyncGroups } from '@repo/sync/service/sync-groups';
import { CommandRejected } from '@repo/sync/types/command-rejected';
import { GroupNotAllowed } from '@repo/sync/types/group-not-allowed';
import { SyncRpcs } from '@repo/sync/types/protocol';
import type { Outcome, Transaction } from '@repo/sync/types/protocol';
import { ServerBehind } from '@repo/sync/types/server-behind';
import { Deferred, Effect, Layer, Queue, Stream } from 'effect';
import { HttpRouter, HttpServerRequest, HttpServerResponse } from 'effect/http';
import { RpcServer } from 'effect/rpc';

/** The path of the sync socket on the server app. */
const syncPath = '/sync';

function rejected(transaction: Transaction, reason: string): Outcome {
  return { transactionId: transaction.id, status: 'rejected', syncId: null, reason };
}

/**
 * The WebSocket protocol of the RPC server, with each socket kept in
 * `Sessions` for its actor. `Sessions.end` can then close the actor's sockets
 * with code 4401. The RPC server upgrades the request itself, so this layer
 * gives it a request whose upgrade also tracks the socket. A request from an
 * origin that `SYNC_ORIGINS` does not list gets 403 before the upgrade.
 */
const trackedWebsocket = Layer.effect(RpcServer.Protocol)(
  Effect.gen(function* () {
    const { httpEffect, protocol } = yield* RpcServer.makeProtocolWithHttpEffectWebsocket;
    const router = yield* HttpRouter.HttpRouter;
    const sessions = yield* Sessions;
    const actors = yield* Actors;
    const origins = yield* syncOrigins;
    yield* router.add('GET', syncPath, (request) => {
      if (!originAllowed(request.headers.origin, origins)) {
        return Effect.succeed(
          HttpServerResponse.text('This origin may not open the sync socket.', { status: 403 }),
        );
      }
      return Effect.gen(function* () {
        const actor = yield* actors.fromHeaders(request.headers);
        const tracked: HttpServerRequest.HttpServerRequest = Object.create(request, {
          upgrade: {
            value: request.upgrade.pipe(
              Effect.tap((socket) => sessions.track(actor.userId, socket)),
            ),
          },
        });
        return yield* httpEffect.pipe(
          Effect.provideService(HttpServerRequest.HttpServerRequest, tracked),
        );
      });
    });
    return protocol;
  }),
);

/**
 * The sync server: `Push`, `Pull` and `Load` over one WebSocket. `changes`
 * lists the server change of every command, from each package's
 * `runtime/handlers.server.ts`. The layer needs the services of every
 * change, and the one `EventLog` of the server app. The actor of each call comes from `Actors`,
 * and the groups it may load come from `SyncGroups`. A server app adds this
 * layer to its router.
 */
export function SyncServer<R>(changes: ReadonlyArray<ServerChange<R>>) {
  const byName = new Map(changes.map((change) => [change.name, change]));
  const handlers = SyncRpcs.toLayer(
    Effect.gen(function* () {
      const log = yield* EventLog;
      // The services of every server change. The composition root provides
      // them, so a missing service fails the typecheck of the server app.
      const services = yield* Effect.context<R>();
      const actors = yield* Actors;
      const syncGroups = yield* SyncGroups;
      // The `Load` queue of each open `Pull` stream, by RPC client. A `Load`
      // that comes before its `Pull` stream opens waits for the queue.
      const requests = new Map<number, Deferred.Deferred<Queue.Queue<string>>>();
      const requestsOf = (id: number) =>
        Effect.gen(function* () {
          const known = requests.get(id);
          if (known) {
            return known;
          }
          const made = yield* Deferred.make<Queue.Queue<string>>();
          requests.set(id, made);
          return made;
        });
      const push = (transaction: Transaction, headers: Readonly<Record<string, string>>) =>
        Effect.gen(function* () {
          const actor = yield* actors.fromHeaders(headers);
          const change = byName.get(transaction.command);
          if (!change) {
            return rejected(transaction, `The server has no command ${transaction.command}.`);
          }
          return yield* log
            .commit(actor.organizationId, transaction.id, (db) =>
              change.run(transaction.input, { db, actor }).pipe(Effect.provideContext(services)),
            )
            .pipe(
              Effect.matchEffect({
                onSuccess: (syncId) =>
                  Effect.succeed<Outcome>({
                    transactionId: transaction.id,
                    status: 'accepted',
                    syncId,
                    reason: null,
                  }),
                onFailure: (failure) =>
                  failure instanceof CommandRejected
                    ? Effect.succeed(rejected(transaction, failure.reason))
                    : Effect.logError('A server change failed', failure).pipe(
                        Effect.as(rejected(transaction, 'The server could not apply this change.')),
                      ),
              }),
            );
        });
      return {
        Push: ({ transactions }, { headers }) =>
          Effect.all(transactions.map((transaction) => push(transaction, headers))),
        // After a database restore, the log can end before the client's last
        // sync ID. The client then loads again from 0.
        Pull: ({ lastSyncId, groups }, { client, headers }) =>
          Stream.unwrap(
            Effect.gen(function* () {
              const actor = yield* actors.fromHeaders(headers);
              const head = yield* log.head(actor.organizationId).pipe(Effect.orDie);
              if (lastSyncId > head) {
                return yield* new ServerBehind({ head });
              }
              const granted = syncGroups.groupsFor(actor);
              const allowed = yield* granted.pipe(Effect.orDie);
              const queue = yield* Queue.unbounded<string>();
              yield* Deferred.succeed(yield* requestsOf(client.id), queue);
              return feed(log, {
                organizationId: actor.organizationId,
                userId: actor.userId,
                lastSyncId,
                loaded: [
                  ...allowed.eager,
                  ...groups.filter((group) => allowed.lazy.includes(group)),
                ],
                granted,
                requests: queue,
              }).pipe(Stream.orDie, Stream.ensuring(Effect.sync(() => requests.delete(client.id))));
            }),
          ),
        Load: ({ group }, { client, headers }) =>
          Effect.gen(function* () {
            const actor = yield* actors.fromHeaders(headers);
            const allowed = yield* syncGroups.groupsFor(actor).pipe(Effect.orDie);
            if (![...allowed.eager, ...allowed.lazy].includes(group)) {
              return yield* new GroupNotAllowed({ group });
            }
            const queue = yield* Deferred.await(yield* requestsOf(client.id));
            yield* Queue.offer(queue, group);
          }),
      };
    }),
  );
  // The server app provides one `EventLog` for the sync server, the job
  // runner and the routes, so a commit from any of them reaches each client.
  return RpcServer.layer(SyncRpcs).pipe(Layer.provide(trackedWebsocket), Layer.provide(handlers));
}
