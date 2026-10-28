import { devActor } from '@repo/identity/config/dev';
import { CurrentActor } from '@repo/identity/service/current-actor';
import { Layer } from 'effect';

/** The development actor, read from the environment with defaults. */
export const CurrentActorDev = Layer.effect(CurrentActor)(devActor);
