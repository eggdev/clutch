import { SyncGroupsFromAccess } from '@repo/access/service/access';
import type { ServicesOf } from '@repo/sync/commands/server-change.server';
import { HttpRoutes } from '@repo/sync/runtime/http-routes.server';
import { JobRunner } from '@repo/sync/runtime/job-runner.server';
import { syncSchedules } from '@repo/sync/runtime/jobs.server';
import { mcpRoute } from '@repo/sync/runtime/mcp.server';
import { migrateSync } from '@repo/sync/runtime/migrate.server';
import { SyncServer } from '@repo/sync/runtime/server.server';
import { Database } from '@repo/sync/service/database';
import { eventLog } from '@repo/sync/service/event-log';
import { OutboxLive } from '@repo/sync/service/jobs';
import type { RouteServicesOf } from '@repo/sync/service/routes';
import { serverOf } from '@repo/sync/service/server-package.server';
import { SessionsLive } from '@repo/sync/service/sessions';
import { Effect, Layer } from 'effect';
import { HttpRouter, HttpServerResponse } from 'effect/http';
import { RpcSerialization } from 'effect/rpc';

import { packages } from '@/packages';

const { contracts, serverChanges, jobs, routes: packageRoutes, migrations } = serverOf(packages);

/** The HTTP routes of the packages, and the MCP endpoint that serves each command with a `tool` declaration. */
const routes = [
  ...packageRoutes,
  mcpRoute<ServicesOf<typeof serverChanges>>(serverChanges, contracts),
];

/** Runs the migrations of the sync engine, then of each package, before the server takes a request. */
const migrated = Layer.effectDiscard(
  Effect.gen(function* () {
    const db = yield* Database;
    for (const migrate of [migrateSync, ...migrations]) {
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
    Layer.mergeAll(
      // The services of every server change, so a change of any package fits
      // without a common supertype among them.
      SyncServer<ServicesOf<typeof serverChanges>>(serverChanges, contracts),
      HttpRoutes<RouteServicesOf<typeof routes>>(routes, contracts),
      health,
    ),
  ).pipe(
    Layer.provide(RpcSerialization.layerJson),
    Layer.provideMerge(JobRunner(jobs, syncSchedules, contracts)),
    Layer.provide(eventLog(contracts)),
    Layer.provide(OutboxLive),
    Layer.provide(SyncGroupsFromAccess),
    Layer.provide(Layer.provideMerge(migrated, database)),
    // The app keeps `Sessions`, so a sign-out can end a user's sockets.
    Layer.provideMerge(SessionsLive),
  );
}
