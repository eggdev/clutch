import { expect, test } from 'bun:test';

import { BunHttpServer } from '@effect/platform-bun';
import { ActorsTest } from '@repo/identity/testing/actor';
import { WebhookSignatureTest } from '@repo/notes/testing/webhook';
import { DatabasePostgres } from '@repo/sync/runtime/database.server';
import { Database } from '@repo/sync/service/database';
import { Sessions } from '@repo/sync/service/sessions';
import { describeOnPostgres, freshDatabase, listening } from '@repo/sync/testing/postgres';
import { Context, Effect, Layer } from 'effect';

import { api } from '@/server';
import { openSocket, syncUrl } from '@/test/socket';

/** One process of the API over the database of `url`, with its own pool, wake and HTTP server, as in production. */
const postgresProcess = (url: string) =>
  api(DatabasePostgres(url)).pipe(
    Layer.provide(ActorsTest()),
    Layer.provide(WebhookSignatureTest),
    Layer.provideMerge(BunHttpServer.layerTest),
  );

describeOnPostgres('the API processes on a real Postgres server', (serverUrl) => {
  test('a sign-out on one API process closes the socket of the user on another', async () => {
    const result = await Effect.runPromise(
      Effect.gen(function* () {
        const urlOf = yield* freshDatabase(serverUrl);
        // One after the other, so the first process migrates the new database.
        const first = yield* Layer.build(postgresProcess(urlOf('first')));
        const second = yield* Layer.build(postgresProcess(urlOf('second')));
        // A connection of the test watches the server, because a process of the API keeps its database inside.
        const watcher = Context.get(yield* Layer.build(DatabasePostgres(urlOf('test'))), Database);
        yield* listening(watcher, 'second');
        const closed = yield* openSocket(yield* syncUrl.pipe(Effect.provideContext(second)));
        const ended = yield* Context.get(first, Sessions).end('user-test');
        return { ended, code: yield* closed };
      }).pipe(Effect.scoped),
    );
    // The first process holds no socket of the user. The second closes its socket with 4401.
    expect(result).toEqual({ ended: { closed: 0, othersTold: true }, code: 4401 });
  }, 30_000);
});
