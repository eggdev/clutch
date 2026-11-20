import { sessionEndedCode } from '@repo/sync/types/session-ended';
import { Context, Effect, Layer } from 'effect';
import type { Scope } from 'effect';
import type { RpcServer } from 'effect/rpc';
import { Socket } from 'effect/socket';

/** The shape of the RPC server's protocol. */
type Protocol = Context.Service.Shape<typeof RpcServer.Protocol>;

/** One open socket: its close as an ended session, and the RPC clients that it carries. */
type Served = { close: Effect.Effect<void>; readonly clients: Set<number> };

/** The socket that the current fiber serves, or none outside `serve`. */
const ServedSocket = Context.Reference<Served | null>('sync/ServedSocket', {
  defaultValue: () => null,
});

/** Closes a socket with code 4401. A client of every build reads it as an ended session. */
export const closeAsEnded = (writer: Socket.Writer) =>
  writer.write(new Socket.CloseEvent(sessionEndedCode, 'The session ended.'));

/**
 * The socket of each RPC client of the sync server, so a call can end its own
 * socket as an ended session. The RPC server gives each socket a client ID,
 * and it reads each message of a socket in the fiber that serves that socket.
 * `serve` marks that fiber, `carry` names its socket, and the protocol that
 * `protocol` gives notes the client ID of each message that it reads there.
 */
export class SocketEnds extends Context.Service<
  SocketEnds,
  {
    /** Serves one socket, from its upgrade until it closes. */
    readonly serve: <A, E, R>(serving: Effect.Effect<A, E, R>) => Effect.Effect<A, E, R>;
    /** Names the socket that the current fiber serves. Call it when the upgrade gives the socket. */
    readonly carry: (socket: Socket.Socket) => Effect.Effect<void, never, Scope.Scope>;
    /** The protocol, with the client ID of each message tied to its socket. */
    readonly protocol: (protocol: Protocol) => Protocol;
    /** Closes the socket of the RPC client with code 4401. */
    readonly end: (clientId: number) => Effect.Effect<void>;
  }
>()('sync/SocketEnds') {}

export const SocketEndsLive = Layer.sync(SocketEnds)(() => {
  const byClient = new Map<number, Served>();
  return SocketEnds.of({
    serve: (serving) =>
      Effect.suspend(() => {
        const served: Served = { close: Effect.void, clients: new Set() };
        return serving.pipe(
          Effect.provideService(ServedSocket, served),
          Effect.ensuring(
            Effect.sync(() => {
              for (const clientId of served.clients) {
                byClient.delete(clientId);
              }
            }),
          ),
        );
      }),
    carry: (socket) =>
      Effect.gen(function* () {
        const served = yield* ServedSocket;
        if (served) {
          const writer = yield* socket.writer;
          served.close = closeAsEnded(writer).pipe(Effect.ignore);
        }
      }),
    protocol: (protocol) => ({
      ...protocol,
      run: (write) =>
        protocol.run((clientId, data) =>
          Effect.gen(function* () {
            const served = yield* ServedSocket;
            if (served && !served.clients.has(clientId)) {
              served.clients.add(clientId);
              byClient.set(clientId, served);
            }
            return yield* write(clientId, data);
          }),
        ),
    }),
    end: (clientId) => Effect.suspend(() => byClient.get(clientId)?.close ?? Effect.void),
  });
});
