import { SyncGroupsFromAccess } from '@repo/access/service/access';
import { HttpRoutes } from '@repo/sync/runtime/http-routes.server';
import { JobRunner } from '@repo/sync/runtime/job-runner.server';
import { SyncServer } from '@repo/sync/runtime/server.server';
import { Database } from '@repo/sync/service/database';
import { EventLogLive } from '@repo/sync/service/event-log';
import { OutboxLive } from '@repo/sync/service/jobs';
import { SessionsLive } from '@repo/sync/service/sessions';
import { Effect, Layer } from 'effect';
import { HttpRouter, HttpServerResponse } from 'effect/http';
import { RpcSerialization } from 'effect/rpc';

import { jobs, migrations, routes, schedules, serverChanges } from '@/packages';

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
 * The API without its HTTP server, database driver, actors or the services of
 * its routes. The composition root in `main.ts` provides them; a test
 * provides test versions. Access names the sync groups that each actor may
 * load. The job runner runs the jobs that the outbox holds.
 */
export function api<E, R>(database: Layer.Layer<Database, E, R>) {
  return HttpRouter.serve(
    Layer.mergeAll(SyncServer(serverChanges), HttpRoutes(routes), health),
  ).pipe(
    Layer.provide(RpcSerialization.layerJson),
    Layer.provideMerge(JobRunner(jobs, schedules)),
    Layer.provide(EventLogLive),
    Layer.provide(OutboxLive),
    Layer.provide(SyncGroupsFromAccess),
    Layer.provide(Layer.provideMerge(migrated, database)),
    // The app keeps `Sessions`, so a sign-out can end a user's sockets.
    Layer.provideMerge(SessionsLive),
  );
}
