import { devActor } from '@repo/identity/config/dev';
import { Actors } from '@repo/identity/service/actors';
import type { RequestHeaders } from '@repo/identity/service/actors';
import { Effect, Layer } from 'effect';

/** The value of one cookie of a request, or `undefined` when the request has none by that name. */
function cookie(headers: RequestHeaders, name: string): string | undefined {
  const pair = (headers.cookie ?? '')
    .split(';')
    .map((part) => part.trim())
    .find((part) => part.startsWith(`${name}=`));
  return pair === undefined ? undefined : decodeURIComponent(pair.slice(name.length + 1));
}

/**
 * The development actors. A connection names its actor with the
 * `x-dev-user-id` and `x-dev-organization-id` headers, or with cookies of the
 * same names without the `x-`. A browser cannot set a header on its sync
 * socket, so a browser session uses the cookies: a journey gives each run an
 * organization of its own that way. A connection with neither is the actor
 * from config. Only local development and tests use this Layer: any client
 * can claim any actor with it.
 */
export const ActorsDev = Layer.effect(Actors)(
  devActor.pipe(
    Effect.map((fallback) => ({
      fromHeaders: (headers) =>
        Effect.succeed({
          userId: headers['x-dev-user-id'] ?? cookie(headers, 'dev-user-id') ?? fallback.userId,
          organizationId:
            headers['x-dev-organization-id'] ??
            cookie(headers, 'dev-organization-id') ??
            fallback.organizationId,
        }),
    })),
  ),
);
