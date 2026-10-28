import { SyncServer } from '@repo/sync/runtime/server.server';
import { Database } from '@repo/sync/service/database';
import { SessionsLive } from '@repo/sync/service/sessions';
import { Effect, Layer } from 'effect';
import { HttpRouter } from 'effect/http';
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

/**
 * The API without its HTTP server, database driver or actor. The composition
 * root in `main.ts` provides them; a test provides test versions.
 */
export function api<E, R>(database: Layer.Layer<Database, E, R>) {
  return HttpRouter.serve(SyncServer(serverChanges)).pipe(
    Layer.provide(RpcSerialization.layerJson),
    Layer.provide(Layer.provideMerge(migrated, database)),
    // The app keeps `Sessions`, so a sign-out can end a user's sockets.
    Layer.provideMerge(SessionsLive),
  );
}
