import type { Route } from '@repo/sync/service/routes';
import { Effect, Layer } from 'effect';
import { HttpRouter, HttpServerResponse } from 'effect/http';

/**
 * Adds each package route to the server app's router. The layer needs the
 * services of every route. A route that fails answers 500, and the failure
 * goes to the log.
 */
export function HttpRoutes<R>(routes: ReadonlyArray<Route<R>>) {
  return Layer.effectDiscard(
    Effect.gen(function* () {
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
