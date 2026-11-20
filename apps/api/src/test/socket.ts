import { BunHttpServer } from '@effect/platform-bun';
import { ActorsTest } from '@repo/identity/testing/actor';
import { WebhookSignatureTest } from '@repo/notes/testing/webhook';
import { DatabasePglite } from '@repo/sync/runtime/database.server';
import { WakePglite } from '@repo/sync/runtime/wake.server';
import { Database } from '@repo/sync/service/database';
import type { SyncMessage } from '@repo/sync/types/protocol';
import { Effect, Layer } from 'effect';
import { HttpServer } from 'effect/http';
import { RpcClient, RpcSerialization } from 'effect/rpc';
import { Socket } from 'effect/socket';

import { api } from '@/server';

/** The whole API on a test HTTP server, over a fresh in-memory database. */
export const testServer = api(DatabasePglite()).pipe(
  Layer.provide(ActorsTest()),
  Layer.provide(WebhookSignatureTest),
  Layer.provideMerge(BunHttpServer.layerTest),
);

/**
 * One process of the API over a database that the test provides, such as
 * `DatabaseTest()`. Each process gets its own wake over that database, so a
 * test can run two processes over one database, and reach the database too.
 */
export const apiProcess = () =>
  api(
    Layer.merge(
      Layer.effect(Database)(
        Effect.gen(function* () {
          return yield* Database;
        }),
      ),
      Layer.fresh(WakePglite),
    ),
  ).pipe(
    Layer.provide(ActorsTest()),
    Layer.provide(WebhookSignatureTest),
    Layer.provideMerge(BunHttpServer.layerTest),
  );

/** The sync socket URL of the test server. */
export const syncUrl = HttpServer.addressFormattedWith((address) =>
  Effect.succeed(`${address.replace('http', 'ws')}/sync`),
);

/** An RPC client over a real socket. `userId` names the development actor of the connection. */
export function socketClient(url: string, userId?: string) {
  const constructor = Layer.succeed(Socket.WebSocketConstructor)(
    (target) => new WebSocket(target, { headers: userId ? { 'x-dev-user-id': userId } : {} }),
  );
  return RpcClient.layerProtocolSocket().pipe(
    Layer.provide(Socket.layerWebSocket(url)),
    Layer.provide(constructor),
    Layer.provide(RpcSerialization.layerJson),
  );
}

/** The deltas of a message, for tests that only read deltas. */
export const deltasOnly = (message: SyncMessage) =>
  message._tag === 'Deltas' ? message.deltas : [];
