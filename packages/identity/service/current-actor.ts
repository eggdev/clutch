import type { Actor } from '@repo/identity/types/actor';
import { Context } from 'effect';

/** The actor of the current connection. A server change reads it to scope its writes. */
export class CurrentActor extends Context.Service<CurrentActor, Actor>()('identity/CurrentActor') {}
