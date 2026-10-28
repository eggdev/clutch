import { CurrentActor } from '@repo/identity/service/current-actor';
import type { Actor } from '@repo/identity/types/actor';
import { Layer } from 'effect';

const testActor: Actor = { userId: 'user-test', organizationId: 'org-test' };

/** A fixed actor for tests. */
export function CurrentActorTest(actor: Actor = testActor) {
  return Layer.succeed(CurrentActor)(actor);
}
