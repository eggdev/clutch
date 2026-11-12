import type { Contract } from '@repo/sync/contract/define';
import { manifestOf } from '@repo/sync/contract/manifest';
import type { Route } from '@repo/sync/service/routes';
import { Effect, Layer } from 'effect';
import { HttpRouter, HttpServerResponse } from 'effect/http';

/**
 * Adds each package route to the server app's router. The layer needs the
 * services of every route. A route that fails answers 500, and the failure
 * goes to the log. `contracts` lists each contract that the app serves. A
 * route that a contract declares and no entry of `routes` lists stops the
 * layer at its start.
 */
export function HttpRoutes<R>(routes: ReadonlyArray<Route<R>>, contracts: ReadonlyArray<Contract>) {
  const listed = new Set(routes.map((route) => route.name));
  const unserved = manifestOf(contracts).routes.filter((declared) => !listed.has(declared.name));
  return Layer.effectDiscard(
    Effect.gen(function* () {
      // A declared route with no code would answer 404. The layer stops at its
      // start instead.
      if (unserved.length) {
        return yield* Effect.die(
          new Error(
            `The server app passes no HTTP route for: ${unserved.map((declared) => declared.name).join(', ')}. Add the routes of each contract to the \`routes\` list of the server app.`,
          ),
        );
      }
      const router = yield* HttpRouter.HttpRouter;
      const services = yield* Effect.context<R>();
      for (const route of routes) {
        yield* router.add(route.method, route.path, (request) =>
          route.handle(request).pipe(
            Effect.provideContext(services),
            Effect.catchCause((cause) =>
              Effect.logError(`The route ${route.method} ${route.path} failed`, cause).pipe(
                Effect.as(HttpServerResponse.text('The server could not answer.', { status: 500 })),
              ),
            ),
          ),
        );
      }
    }),
  );
}
