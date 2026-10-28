import { CurrentActor } from '@repo/identity/service/current-actor';
import type { ServerChange } from '@repo/sync/commands/define.server';
import { EventLog, EventLogLive } from '@repo/sync/service/event-log';
import { CommandRejected } from '@repo/sync/types/command-rejected';
import { SyncRpcs } from '@repo/sync/types/protocol';
import type { Outcome, Transaction } from '@repo/sync/types/protocol';
import { Effect, Layer, Stream } from 'effect';
import { RpcServer } from 'effect/rpc';

/** The path of the sync socket on the server app. */
const syncPath = '/sync';

function rejected(transaction: Transaction, reason: string): Outcome {
  return { transactionId: transaction.id, status: 'rejected', syncId: null, reason };
}

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
  return RpcServer.layerHttp({ group: SyncRpcs, path: syncPath, protocol: 'websocket' }).pipe(
    Layer.provide(handlers),
    Layer.provide(EventLogLive),
  );
}
