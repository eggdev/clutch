import { expect, test } from 'bun:test';

import { sign } from '@repo/notes/service/webhook-signature';
import { webhookTestSecret } from '@repo/notes/testing/webhook';
import { SyncRpcs } from '@repo/sync/types/protocol';
import { Effect, Fiber, Stream } from 'effect';
import { HttpServer } from 'effect/http';
import { RpcClient } from 'effect/rpc';

import { deltasOnly, socketClient as client, testServer as server } from '@/test/socket';

test('a signed webhook reaches each client, and the job runner then sends the space count', async () => {
  const models = await Effect.runPromise(
    Effect.gen(function* () {
      const address = yield* HttpServer.addressFormattedWith((value) => Effect.succeed(value));
      const url = `${address.replace('http', 'ws')}/sync`;
      return yield* Effect.gen(function* () {
        const rpc = yield* RpcClient.make(SyncRpcs);
        const reading = yield* rpc.Pull({ lastSyncId: 0, groups: ['space:general'] }).pipe(
          Stream.map(deltasOnly),
          Stream.flatMap((deltas) => Stream.fromIterable(deltas)),
          Stream.flatMap((delta) => Stream.fromIterable(delta.changes)),
          Stream.map((change) => change.model),
          Stream.take(2),
          Stream.runCollect,
          Effect.forkChild,
        );
        yield* Effect.sleep('100 millis');
        const body = JSON.stringify({
          eventId: 'evt-api',
          organizationId: 'org-test',
          title: 'Imported',
        });
        const signature = yield* sign(webhookTestSecret, body);
        const response = yield* Effect.promise(() =>
          fetch(`${address}/webhooks/notes`, {
            method: 'POST',
            body,
            headers: { 'x-notes-signature': signature },
          }),
        );
        expect(response.status).toBe(200);
        return yield* Fiber.join(reading).pipe(Effect.timeout('5 seconds'));
      }).pipe(Effect.scoped, Effect.provide(client(url)));
    }).pipe(Effect.provide(server)),
  );
  expect(models).toEqual(['Note', 'SpaceNoteCount']);
}, 15_000);
