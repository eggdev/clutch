import { expect, test } from 'bun:test';

import { defineContract } from '@repo/sync/contract/define';
import { route } from '@repo/sync/contract/route';
import { HttpRoutes } from '@repo/sync/runtime/http-routes.server';
import { defineRoute } from '@repo/sync/service/routes';
import { Cause, Effect, Exit, Layer } from 'effect';
import { HttpRouter, HttpServerResponse } from 'effect/http';

const pingDeclaration = route('test/ping', {
  method: 'GET',
  path: '/ping',
  body: 'none',
  says: 'A monitor.',
});
const pingContract = defineContract('test', {
  records: [],
  commands: [],
  loads: [],
  routes: [pingDeclaration],
});
const ping = defineRoute(pingDeclaration, () => Effect.succeed(HttpServerResponse.text('pong')));

/** Starts the routes in a router of a scope, then ends the scope. The exit says whether it started. */
function startRoutes(routes: Layer.Layer<never, unknown, HttpRouter.HttpRouter>) {
  return Effect.runPromiseExit(
    Effect.scoped(Layer.build(routes)).pipe(Effect.provide(HttpRouter.layer)),
  );
}

function causeOf(exit: Exit.Exit<unknown, unknown>) {
  return Exit.isFailure(exit) ? Cause.pretty(exit.cause) : '';
}

test('a route that a contract declares and no list lists stops the routes at their start', async () => {
  const exit = await startRoutes(HttpRoutes([], [pingContract]));
  expect(exit._tag).toBe('Failure');
  expect(causeOf(exit)).toContain(
    'The server app passes no HTTP route for: test/ping. Add the routes of each contract to the `routes` list of the server app.',
  );
});

test('the same routes start when they list the declared route', async () => {
  const exit = await startRoutes(HttpRoutes([ping], [pingContract]));
  expect(exit._tag).toBe('Success');
});

test('a route that no contract declares does not stop the routes', async () => {
  const exit = await startRoutes(HttpRoutes([ping], []));
  expect(exit._tag).toBe('Success');
});
