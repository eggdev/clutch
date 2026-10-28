import { notesServerChanges } from '@repo/notes/runtime/handlers.server';
import { migrateNotes } from '@repo/notes/runtime/migrate.server';
import { migrateSync } from '@repo/sync/runtime/migrate.server';
import { SyncServer } from '@repo/sync/runtime/server.server';
import { Database } from '@repo/sync/service/database';
import { Effect, Layer } from 'effect';
import { HttpRouter } from 'effect/http';
import { RpcSerialization } from 'effect/rpc';

/** Runs the migrations of each package before the server takes a request. */
const migrated = Layer.effectDiscard(
  Effect.gen(function* () {
    const db = yield* Database;
    yield* migrateSync(db);
    yield* migrateNotes(db);
  }),
);

/**
 * The API without its HTTP server, database driver or actor. The composition
 * root in `main.ts` provides them; a test provides test versions.
 */
export function api<E, R>(database: Layer.Layer<Database, E, R>) {
  return HttpRouter.serve(SyncServer(notesServerChanges)).pipe(
    Layer.provide(RpcSerialization.layerJson),
    Layer.provide(Layer.provideMerge(migrated, database)),
  );
}
