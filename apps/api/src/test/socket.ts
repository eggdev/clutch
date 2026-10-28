import { BunHttpServer } from '@effect/platform-bun';
import { ActorsTest } from '@repo/identity/testing/actor';
import { DatabasePglite } from '@repo/sync/runtime/database.server';
import type { SyncMessage } from '@repo/sync/types/protocol';
import { Effect, Layer } from 'effect';
import { HttpServer } from 'effect/http';
import { RpcClient, RpcSerialization } from 'effect/rpc';
import { Socket } from 'effect/socket';

import { api } from '@/server';

/** The whole API on a test HTTP server, over a fresh in-memory database. */
export const testServer = api(DatabasePglite()).pipe(
  Layer.provide(ActorsTest()),
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
