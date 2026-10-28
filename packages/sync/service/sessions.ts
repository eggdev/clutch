import { sessionEndedCode } from '@repo/sync/types/session-ended';
import { Context, Effect, Layer } from 'effect';
import type { Scope } from 'effect';
import { Socket } from 'effect/socket';

/**
 * The open sync sockets of each user. A sign-out ends the session: identity
 * calls `end` with the user, and each of that user's sockets closes with
 * code 4401.
 */
export class Sessions extends Context.Service<
  Sessions,
  {
    /** Keeps the socket until its scope closes. */
    readonly track: (
      userId: string,
      socket: Socket.Socket,
    ) => Effect.Effect<void, never, Scope.Scope>;
    /** Closes each open socket of the user. Returns how many it closed. */
    readonly end: (userId: string) => Effect.Effect<number>;
  }
>()('sync/Sessions') {}

export const SessionsLive = Layer.effect(Sessions)(
  Effect.sync(() => {
    const open = new Map<string, Set<Effect.Effect<void>>>();
    return Sessions.of({
      track: Effect.fnUntraced(function* (userId: string, socket: Socket.Socket) {
        const writer = yield* socket.writer;
        const close = writer
          .write(new Socket.CloseEvent(sessionEndedCode, 'The session ended.'))
          .pipe(Effect.ignore);
        const sockets = open.get(userId) ?? new Set();
        sockets.add(close);
        open.set(userId, sockets);
        yield* Effect.addFinalizer(() =>
          Effect.sync(() => {
            sockets.delete(close);
            if (sockets.size === 0) {
              open.delete(userId);
            }
          }),
        );
      }),
      end: (userId) =>
        Effect.gen(function* () {
          const sockets = [...(open.get(userId) ?? [])];
          yield* Effect.all(sockets, { discard: true });
          return sockets.length;
        }),
    });
  }),
);
