import { CurrentActor } from '@repo/identity/service/current-actor';
import type { ServerChange } from '@repo/sync/commands/define.server';
import { EventLog, EventLogLive } from '@repo/sync/service/event-log';
import { Sessions } from '@repo/sync/service/sessions';
import { CommandRejected } from '@repo/sync/types/command-rejected';
import { SyncRpcs } from '@repo/sync/types/protocol';
import type { Outcome, Transaction } from '@repo/sync/types/protocol';
import { Effect, Layer, Stream } from 'effect';
import { HttpRouter, HttpServerRequest } from 'effect/http';
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
 * gives it a request whose upgrade also tracks the socket.
 */
const trackedWebsocket = Layer.effect(RpcServer.Protocol)(
  Effect.gen(function* () {
    const { httpEffect, protocol } = yield* RpcServer.makeProtocolWithHttpEffectWebsocket;
    const router = yield* HttpRouter.HttpRouter;
    const sessions = yield* Sessions;
    const actor = yield* CurrentActor;
    yield* router.add('GET', syncPath, (request) => {
      const tracked: HttpServerRequest.HttpServerRequest = Object.create(request, {
        upgrade: {
          value: request.upgrade.pipe(Effect.tap((socket) => sessions.track(actor.userId, socket))),
        },
      });
      return httpEffect.pipe(Effect.provideService(HttpServerRequest.HttpServerRequest, tracked));
    });
    return protocol;
  }),
);

/**
 * The sync server: the `Push` and `Pull` calls over one WebSocket. `changes`
 * lists the server change of every command, from each package's
 * `runtime/handlers.server.ts`. A server app adds this layer to its router.
 */
export function SyncServer(changes: ReadonlyArray<ServerChange>) {
  const byName = new Map(changes.map((change) => [change.name, change]));
  const handlers = SyncRpcs.toLayer(
    Effect.gen(function* () {
      const log = yield* EventLog;
      const actor = yield* CurrentActor;
      const push = (transaction: Transaction) => {
        const change = byName.get(transaction.command);
        if (!change) {
          return Effect.succeed(
            rejected(transaction, `The server has no command ${transaction.command}.`),
          );
        }
        return log
          .commit(actor.organizationId, transaction.id, (db) =>
            change.run(transaction.input, { db, actor }),
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
      };
      return {
        Push: ({ transactions }) => Effect.all(transactions.map(push)),
        Pull: ({ lastSyncId }) => log.deltas(actor.organizationId, lastSyncId).pipe(Stream.orDie),
      };
    }),
  );
  return RpcServer.layer(SyncRpcs).pipe(
    Layer.provide(trackedWebsocket),
    Layer.provide(handlers),
    Layer.provide(EventLogLive),
  );
}
