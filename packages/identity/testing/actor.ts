import { Actors } from '@repo/identity/service/actors';
import type { Actor } from '@repo/identity/types/actor';
import { Effect, Layer } from 'effect';

/** The actor of a test that names no other one. */
export const testActor: Actor = { userId: 'user-test', organizationId: 'org-test' };

/**
 * Actors for tests: `x-dev-user-id` picks the user, and every other
 * connection is `actor`.
 */
export function ActorsTest(actor: Actor = testActor) {
  return Layer.succeed(Actors)({
    fromHeaders: (headers) =>
      Effect.succeed({
        userId: headers['x-dev-user-id'] ?? actor.userId,
        organizationId: headers['x-dev-organization-id'] ?? actor.organizationId,
      }),
  });
}
