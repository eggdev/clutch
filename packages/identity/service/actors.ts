import type { Actor } from '@repo/identity/types/actor';
import { Context } from 'effect';
import type { Effect } from 'effect';

/** The request headers of a connection, keyed by lowercase name. */
export type RequestHeaders = Readonly<Record<string, string | undefined>>;

/**
 * Finds the actor of a connection from its request headers. The sync server
 * asks it once for each socket and each call, so two clients of one server
 * can be two actors. A project's sign-in vendor provides the Live Layer in
 * `runtime/`; the development Layer reads the actor from headers or config.
 */
export class Actors extends Context.Service<
  Actors,
  { readonly fromHeaders: (headers: RequestHeaders) => Effect.Effect<Actor> }
>()('identity/Actors') {}
