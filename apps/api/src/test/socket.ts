import { BunHttpServer } from '@effect/platform-bun';
import type { Actors } from '@repo/identity/service/actors';
import { ActorsTest } from '@repo/identity/testing/actor';
import { WebhookSignatureTest } from '@repo/notes/testing/webhook';
import { DatabasePglite } from '@repo/sync/runtime/database.server';
import { WakePglite } from '@repo/sync/runtime/wake.server';
import { Database } from '@repo/sync/service/database';
import type { SyncMessage } from '@repo/sync/types/protocol';
import { Deferred, Effect, Layer } from 'effect';
import { HttpServer } from 'effect/http';
import { RpcClient, RpcSerialization } from 'effect/rpc';
import { Socket } from 'effect/socket';

import { api } from '@/server';

/** The whole API on a test HTTP server, over a fresh in-memory database, with these actors. */
export function testServerWith(actors: Layer.Layer<Actors>) {
  return api(DatabasePglite()).pipe(
    Layer.provide(actors),
    Layer.provide(WebhookSignatureTest),
    Layer.provideMerge(BunHttpServer.layerTest),
  );
}

/** The whole API on a test HTTP server, over a fresh in-memory database. */
export const testServer = testServerWith(ActorsTest());

/**
 * One process of the API over a database that the test provides, such as
 * `DatabaseTest()`. Each process gets its own wake over that database, so a
 * test can run two processes over one database, and reach the database too.
 * A test can give a wake of its own, such as one that cannot send.
 */
export const apiProcess = (wake = WakePglite) =>
  api(
    Layer.merge(
      Layer.effect(Database)(
        Effect.gen(function* () {
          return yield* Database;
        }),
      ),
      Layer.fresh(wake),
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

/**
 * An RPC client over a real socket, as `socketClient` gives, and the close
 * code of its first socket. `closed` waits for that close.
 */
export const watchedSocketClient = (url: string) =>
  Effect.gen(function* () {
    const code = yield* Deferred.make<number>();
    const constructor = Layer.succeed(Socket.WebSocketConstructor)((target) => {
      const socket = new WebSocket(target);
      socket.addEventListener('close', (event) => {
        Deferred.doneUnsafe(code, Effect.succeed(event.code));
      });
      return socket;
    });
    const client = RpcClient.layerProtocolSocket().pipe(
      Layer.provide(Socket.layerWebSocket(url)),
      Layer.provide(constructor),
      Layer.provide(RpcSerialization.layerJson),
    );
    return { client, code };
  });

/** The deltas of a message, for tests that only read deltas. */
export const deltasOnly = (message: SyncMessage) =>
  message._tag === 'Deltas' ? message.deltas : [];

/** Opens a socket to `url`. The effect that it returns gives the close code, even of a close before it runs. */
export const openSocket = (url: string) =>
  Effect.gen(function* () {
    const socket = new WebSocket(url);
    const code = new Promise<number>((resolve) => {
      socket.addEventListener('close', (event) => resolve(event.code));
    });
    yield* Effect.callback<true>((resume) => {
      socket.addEventListener('open', () => resume(Effect.succeed(true)));
    });
    return Effect.promise(() => code);
  });
