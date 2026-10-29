import { expect, test } from 'bun:test';

import { Sessions } from '@repo/sync/service/sessions';
import { SyncRpcs } from '@repo/sync/types/protocol';
import { Effect, Fiber, Stream } from 'effect';
import { HttpServer } from 'effect/http';
import { RpcClient } from 'effect/rpc';

import { deltasOnly, socketClient as client, testServer as server } from '@/test/socket';

test('the sender gets the delta of its own transaction over the socket', async () => {
  const result = await Effect.runPromise(
    Effect.gen(function* () {
      const url = yield* HttpServer.addressFormattedWith((address) =>
        Effect.succeed(`${address.replace('http', 'ws')}/sync`),
      );
      return yield* Effect.gen(function* () {
        const rpc = yield* RpcClient.make(SyncRpcs);
        const reading = yield* rpc.Pull({ lastSyncId: 0, groups: ['space:general'] }).pipe(
          Stream.map(deltasOnly),
          Stream.filter((deltas) => deltas.length > 0),
          Stream.take(1),
          Stream.runCollect,
          Effect.forkChild,
        );
        yield* Effect.sleep('100 millis');
        const outcomes = yield* rpc.Push({
          transactions: [
            {
              id: 't1',
              command: 'notes/create',
              input: {
                id: 'n1',
                spaceId: 'general',
                title: 'Hello',
                at: '2026-10-28T12:00:00.000Z',
              },
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

/** A create-note transaction with the note ID in its transaction ID. */
const create = (id: string) => ({
  id: `t-${id}`,
  command: 'notes/create',
  input: { id, spaceId: 'general', title: id, at: '2026-10-28T12:00:00.000Z' },
});

test('another client gets the first delta live, with no second change', async () => {
  const received = await Effect.runPromise(
    Effect.gen(function* () {
      const url = yield* HttpServer.addressFormattedWith((address) =>
        Effect.succeed(`${address.replace('http', 'ws')}/sync`),
      );
      const sender = Effect.gen(function* () {
        const rpc = yield* RpcClient.make(SyncRpcs);
        return yield* rpc.Push({ transactions: [create('n1')] });
      }).pipe(Effect.scoped, Effect.provide(client(url)));
      return yield* Effect.gen(function* () {
        const rpc = yield* RpcClient.make(SyncRpcs);
        const reading = yield* rpc.Pull({ lastSyncId: 0, groups: ['space:general'] }).pipe(
          Stream.map(deltasOnly),
          Stream.filter((deltas) => deltas.length > 0),
          Stream.take(1),
          Stream.runCollect,
          Effect.forkChild,
        );
        yield* Effect.sleep('100 millis');
        yield* sender;
        return yield* Fiber.join(reading).pipe(Effect.timeout('1 second'));
      }).pipe(Effect.scoped, Effect.provide(client(url)));
    }).pipe(Effect.provide(server)),
  );
  expect(received.flat().map((delta) => delta.transactionId)).toEqual(['t-n1']);
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
      // A refused origin gets a plain 403 response, so `fetch` returns.
      const refused = yield* Effect.promise(() =>
        fetch(url, { headers: { ...upgrade, ...key, origin: 'https://evil.example' } }).then(
          (response) => response.status,
        ),
      );
      // An allowed origin upgrades, and an upgraded connection never ends a
      // `fetch`. A real socket shows the upgrade, then closes.
      const opened = yield* Effect.promise(
        () =>
          new Promise<boolean>((resolve) => {
            const socket = new WebSocket(url.replace('http', 'ws'), {
              headers: { origin: 'http://localhost:5173' },
            });
            socket.addEventListener('open', () => {
              socket.close();
              resolve(true);
            });
            socket.addEventListener('error', () => resolve(false));
          }),
      );
      return [refused, opened] as const;
    }).pipe(Effect.provide(server)),
  );
  expect(statuses[0]).toBe(403);
  expect(statuses[1]).toBe(true);
});

test('a pull from a sync ID past the log end fails with ServerBehind, as after a restore', async () => {
  const failure = await Effect.runPromise(
    Effect.gen(function* () {
      const url = yield* HttpServer.addressFormattedWith((address) =>
        Effect.succeed(`${address.replace('http', 'ws')}/sync`),
      );
      return yield* Effect.gen(function* () {
        const rpc = yield* RpcClient.make(SyncRpcs);
        return yield* rpc.Pull({ lastSyncId: 99, groups: [] }).pipe(Stream.runCollect, Effect.flip);
      }).pipe(Effect.scoped, Effect.provide(client(url)));
    }).pipe(Effect.provide(server)),
  );
  expect(failure).toMatchObject({ _tag: 'ServerBehind', head: 0 });
});
