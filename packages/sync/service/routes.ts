import { Effect } from 'effect';
import type { HttpServerRequest, HttpServerResponse } from 'effect/http';

/**
 * One HTTP route of a package, such as a webhook. A package lists its routes
 * in `runtime/routes.server.ts`, and the server app adds them to its router.
 * A route that writes uses `commitAsSystem`, so each client gets a delta.
 */
export type Route<R = never> = {
  readonly method: 'GET' | 'POST' | 'PUT' | 'DELETE';
  readonly path: `/${string}`;
  readonly handle: (
    request: HttpServerRequest.HttpServerRequest,
  ) => Effect.Effect<HttpServerResponse.HttpServerResponse, unknown, R>;
};

/** Defines a route. The type checks the method, the path and the handler. */
export function defineRoute<R>(route: Route<R>): Route<R> {
  return { ...route, handle: (request) => Effect.suspend(() => route.handle(request)) };
}
