import { Wake } from '@repo/sync/service/wake';
import { sessionEndedCode } from '@repo/sync/types/session-ended';
import { Context, Effect, Layer, Schedule, Stream } from 'effect';
import type { Scope } from 'effect';
import { Socket } from 'effect/socket';

/**
 * How `end` went. `closed` counts the sockets that it closed in this process.
 * `othersTold` is false when the signal to the other processes failed, so
 * they may still hold sockets of the user.
 */
export type Ended = { readonly closed: number; readonly othersTold: boolean };

/**
 * The open sync sockets of each user. A sign-out ends the session: identity
 * calls `end` with the user, and each of that user's sockets closes with
 * code 4401, in each process of the server. `end` closes the sockets of its
 * own process, and tells the others through `Wake`.
 */
export class Sessions extends Context.Service<
  Sessions,
  {
    /** Keeps the socket until its scope closes. */
    readonly track: (
      userId: string,
      socket: Socket.Socket,
    ) => Effect.Effect<void, never, Scope.Scope>;
    /** Closes each open socket of the user, in this process and through the wake in the others. */
    readonly end: (userId: string) => Effect.Effect<Ended>;
  }
>()('sync/Sessions') {}

export const SessionsLive = Layer.effect(Sessions)(
  Effect.gen(function* () {
    const wake = yield* Wake;
    const open = new Map<string, Set<Effect.Effect<void>>>();
    const closeAll = (userId: string) =>
      Effect.gen(function* () {
        const sockets = [...(open.get(userId) ?? [])];
        yield* Effect.all(sockets, { discard: true });
        return sockets.length;
      });
    // A sign-out in another process closes the user's sockets here too.
    yield* Stream.runForEach(wake.signals, (signal) =>
      signal.kind === 'end' ? closeAll(signal.userId) : Effect.void,
    ).pipe(Effect.forkScoped);
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
          const closed = yield* closeAll(userId);
          // An end has no transaction to send with, so a failed send is tried three more times.
          const othersTold = yield* wake.send({ kind: 'end', userId }).pipe(
            Effect.retry({ schedule: Schedule.spaced('100 millis'), times: 3 }),
            Effect.as(true),
            Effect.catchCause((cause) =>
              Effect.as(
                Effect.logError(
                  'A sign-out could not tell the other server processes. They may still hold sockets of the user.',
                  cause,
                ),
                false,
              ),
            ),
          );
          return { closed, othersTold };
        }),
    });
  }),
);
