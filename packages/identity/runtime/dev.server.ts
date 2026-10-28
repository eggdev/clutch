import { devActor } from '@repo/identity/config/dev';
import { Actors } from '@repo/identity/service/actors';
import { Effect, Layer } from 'effect';

/**
 * The development actors. A connection names its actor with the
 * `x-dev-user-id` and `x-dev-organization-id` headers; a connection without
 * them is the actor from config. Only local development and tests use this
 * Layer: any client can claim any actor with it.
 */
export const ActorsDev = Layer.effect(Actors)(
  devActor.pipe(
    Effect.map((fallback) => ({
      fromHeaders: (headers) =>
        Effect.succeed({
          userId: headers['x-dev-user-id'] ?? fallback.userId,
          organizationId: headers['x-dev-organization-id'] ?? fallback.organizationId,
        }),
    })),
  ),
);
