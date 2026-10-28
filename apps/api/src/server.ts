import { SyncServer } from '@repo/sync/runtime/server.server';
import { Database } from '@repo/sync/service/database';
import { SessionsLive } from '@repo/sync/service/sessions';
import { Effect, Layer } from 'effect';
import { HttpRouter, HttpServerResponse } from 'effect/http';
import { RpcSerialization } from 'effect/rpc';

import { migrations, serverChanges } from '@/packages';

/** Runs the migrations of each package before the server takes a request. */
const migrated = Layer.effectDiscard(
  Effect.gen(function* () {
    const db = yield* Database;
    for (const migrate of migrations) {
      yield* migrate(db);
    }
  }),
);

/** `GET /health` answers 200, so the dev command can see that the API runs. */
const health = Layer.effectDiscard(
  Effect.gen(function* () {
    const router = yield* HttpRouter.HttpRouter;
    yield* router.add('GET', '/health', () => Effect.succeed(HttpServerResponse.text('ok')));
  }),
);

/**
 * The API without its HTTP server, database driver or actor. The composition
 * root in `main.ts` provides them; a test provides test versions.
 */
export function api<E, R>(database: Layer.Layer<Database, E, R>) {
  return HttpRouter.serve(Layer.mergeAll(SyncServer(serverChanges), health)).pipe(
    Layer.provide(RpcSerialization.layerJson),
    Layer.provide(Layer.provideMerge(migrated, database)),
    // The app keeps `Sessions`, so a sign-out can end a user's sockets.
    Layer.provideMerge(SessionsLive),
  );
}
