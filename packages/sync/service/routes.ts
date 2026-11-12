import { matches } from '@repo/sync/contract/fields';
import type { TypeOf } from '@repo/sync/contract/fields';
import type { PayloadFields } from '@repo/sync/contract/job';
import type { RouteDeclaration, RouteMethod } from '@repo/sync/contract/route';
import { Effect } from 'effect';
import type { HttpServerRequest, HttpServerResponse } from 'effect/http';

/**
 * One HTTP route of a package, such as a webhook. A package declares its
 * route in its contract, and lists its code in `runtime/routes.server.ts`.
 * The server app adds the list to its router. A route that writes uses
 * `commitAsSystem`, so each client gets a delta.
 */
export type Route<R = never> = {
  readonly name: string;
  readonly method: RouteMethod;
  readonly path: `/${string}`;
  readonly handle: (
    request: HttpServerRequest.HttpServerRequest,
  ) => Effect.Effect<HttpServerResponse.HttpServerResponse, unknown, R>;
};

/** The services that a list of routes needs. The server app provides each one. */
export type RouteServicesOf<Routes extends ReadonlyArray<Route<unknown>>> =
  Routes[number] extends Route<infer R> ? R : never;

/**
 * Defines the code of a declared route. The method, the path and the name
 * come from the declaration. The handler gets the raw request, so a webhook
 * can check a signature over the raw text before it reads the body with `bodyOf`.
 */
export function defineRoute<const Name extends string, const F extends PayloadFields, R>(
  declaration: RouteDeclaration<Name, F>,
  handle: (
    request: HttpServerRequest.HttpServerRequest,
  ) => Effect.Effect<HttpServerResponse.HttpServerResponse, unknown, R>,
): Route<R> & { readonly name: Name } {
  return {
    name: declaration.name,
    method: declaration.method,
    path: declaration.path,
    handle: (request) => Effect.suspend(() => handle(request)),
  };
}

/**
 * The typed body of a request, from its raw JSON text. It is `undefined` when
 * the text is not JSON, when the route reads no body, or when the JSON lacks a
 * field of the declaration or has one of the wrong kind.
 */
export function bodyOf<F extends PayloadFields>(
  declaration: RouteDeclaration<string, F>,
  text: string,
): TypeOf<F> | undefined {
  if (declaration.body === 'none') {
    return undefined;
  }
  let value: unknown;
  try {
    value = JSON.parse(text);
  } catch {
    return undefined;
  }
  return matches(declaration.body, value) ? value : undefined;
}
