import { expect, test } from 'bun:test';

import { CurrentActorDev } from '@repo/identity/runtime/dev.server';
import { CurrentActor } from '@repo/identity/service/current-actor';
import { ConfigProvider, Effect, Layer } from 'effect';

function actorFrom(env: Record<string, string>) {
  return Effect.runPromise(
    Effect.gen(function* () {
      return yield* CurrentActor;
    }).pipe(
      Effect.provide(
        CurrentActorDev.pipe(Layer.provide(ConfigProvider.layer(ConfigProvider.fromEnv({ env })))),
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
