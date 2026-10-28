import { expect, test } from 'bun:test';

import { BunHttpServer } from '@effect/platform-bun';
import { CurrentActorTest } from '@repo/identity/testing/actor';
import { DatabasePglite } from '@repo/sync/runtime/database.server';
import { Sessions } from '@repo/sync/service/sessions';
import { SyncRpcs } from '@repo/sync/types/protocol';
import { Effect, Fiber, Layer, Stream } from 'effect';
import { HttpServer } from 'effect/http';
import { RpcClient, RpcSerialization } from 'effect/rpc';
import { Socket } from 'effect/socket';

import { api } from '@/server';

const server = api(DatabasePglite()).pipe(
  Layer.provide(CurrentActorTest()),
  Layer.provideMerge(BunHttpServer.layerTest),
);

function client(url: string) {
  return RpcClient.layerProtocolSocket().pipe(
    Layer.provide(Socket.layerWebSocket(url)),
    Layer.provide(Socket.layerWebSocketConstructorGlobal),
    Layer.provide(RpcSerialization.layerJson),
  );
}

test('the sender gets the delta of its own transaction over the socket', async () => {
  const result = await Effect.runPromise(
    Effect.gen(function* () {
      const url = yield* HttpServer.addressFormattedWith((address) =>
        Effect.succeed(`${address.replace('http', 'ws')}/sync`),
      );
      return yield* Effect.gen(function* () {
        const rpc = yield* RpcClient.make(SyncRpcs);
        const reading = yield* rpc
          .Pull({ lastSyncId: 0 })
          .pipe(Stream.take(1), Stream.runCollect, Effect.forkChild);
        yield* Effect.sleep('100 millis');
        const outcomes = yield* rpc.Push({
          transactions: [
            {
              id: 't1',
              command: 'notes/create',
              input: { id: 'n1', title: 'Hello', at: '2026-10-28T12:00:00.000Z' },
            },
            {
              id: 't2',
              command: 'notes/rename',
              input: { id: 'missing', title: 'x', at: '2026-10-28T12:00:00.000Z' },
            },
          ],
        });
        const [deltas] = yield* Fiber.join(reading);
        return { outcomes, deltas };
      }).pipe(Effect.scoped, Effect.provide(client(url)));
    }).pipe(Effect.provide(server)),
  );
  expect(result.outcomes.map((outcome) => outcome.status)).toEqual(['accepted', 'rejected']);
  expect(result.deltas?.[0]?.transactionId).toBe('t1');
  expect(result.deltas?.[0]?.changes[0]).toMatchObject({
    model: 'Note',
    id: 'n1',
    data: { title: 'Hello' },
  });
});

test('a sign-out closes each socket of the user with code 4401', async () => {
  const result = await Effect.runPromise(
    Effect.gen(function* () {
      const url = yield* HttpServer.addressFormattedWith((address) =>
        Effect.succeed(`${address.replace('http', 'ws')}/sync`),
      );
      const socket = new WebSocket(url);
      const closed = Effect.callback<number>((resume) => {
        socket.addEventListener('close', (event) => resume(Effect.succeed(event.code)));
      });
      yield* Effect.callback<true>((resume) => {
        socket.addEventListener('open', () => resume(Effect.succeed(true)));
      });
      const sessions = yield* Sessions;
      const ended = yield* sessions.end('user-test');
      return { ended, code: yield* closed };
    }).pipe(Effect.provide(server)),
  );
  expect(result).toEqual({ ended: 1, code: 4401 });
});

test('a socket request from an origin that SYNC_ORIGINS does not list gets 403', async () => {
  const statuses = await Effect.runPromise(
    Effect.gen(function* () {
      const url = yield* HttpServer.addressFormattedWith((address) =>
        Effect.succeed(`${address}/sync`),
      );
      const upgrade = {
        connection: 'Upgrade',
        upgrade: 'websocket',
        'sec-websocket-version': '13',
      };
      const key = { 'sec-websocket-key': 'dGhlIHNhbXBsZSBub25jZQ==' };
      const status = (origin: string) =>
        Effect.promise(() =>
          fetch(url, { headers: { ...upgrade, ...key, origin } }).then(
            (response) => response.status,
          ),
        );
      return [yield* status('https://evil.example'), yield* status('http://localhost:5173')];
    }).pipe(Effect.provide(server)),
  );
  expect(statuses[0]).toBe(403);
  expect(statuses[1]).not.toBe(403);
});

test('a pull from a sync ID past the log end fails with ServerBehind, as after a restore', async () => {
  const failure = await Effect.runPromise(
    Effect.gen(function* () {
      const url = yield* HttpServer.addressFormattedWith((address) =>
        Effect.succeed(`${address.replace('http', 'ws')}/sync`),
      );
      return yield* Effect.gen(function* () {
        const rpc = yield* RpcClient.make(SyncRpcs);
        return yield* rpc.Pull({ lastSyncId: 99 }).pipe(Stream.runCollect, Effect.flip);
      }).pipe(Effect.scoped, Effect.provide(client(url)));
    }).pipe(Effect.provide(server)),
  );
  expect(failure).toMatchObject({ _tag: 'ServerBehind', head: 0 });
});
