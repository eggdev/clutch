import { expect, test } from 'bun:test';

import { ActorsDev } from '@repo/identity/runtime/dev.server';
import { Actors } from '@repo/identity/service/actors';
import type { RequestHeaders } from '@repo/identity/service/actors';
import { ConfigProvider, Effect, Layer } from 'effect';

function actorFrom(env: Record<string, string>, headers: RequestHeaders = {}) {
  return Effect.runPromise(
    Effect.gen(function* () {
      const actors = yield* Actors;
      return yield* actors.fromHeaders(headers);
    }).pipe(
      Effect.provide(
        ActorsDev.pipe(Layer.provide(ConfigProvider.layer(ConfigProvider.fromEnv({ env })))),
      ),
    ),
  );
}

test('the development actor has defaults, and the environment can set it', async () => {
  expect(await actorFrom({})).toEqual({ userId: 'user-dev', organizationId: 'org-dev' });
  expect(await actorFrom({ DEV_ORGANIZATION_ID: 'org-b' })).toMatchObject({
    organizationId: 'org-b',
  });
});

test('a connection can name its development actor in headers', async () => {
  expect(await actorFrom({}, { 'x-dev-user-id': 'user-b' })).toEqual({
    userId: 'user-b',
    organizationId: 'org-dev',
  });
});
