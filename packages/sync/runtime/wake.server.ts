import { PgClient } from '@effect/sql-pg';
import { PgliteClient } from '@effect/sql-pglite';
import { Wake, WakeSignal } from '@repo/sync/service/wake';
import { sql } from 'drizzle-orm';
import { Effect, Layer, Option, PubSub, Schedule, Schema, Stream } from 'effect';
import type { Scope } from 'effect';

/** The database channel of the wake. A payload stays far below the 8,000 bytes that Postgres allows. */
const channel = 'sync_wake';

/** One signal on the channel, with the process that sent it. */
const Envelope = Schema.fromJsonString(Schema.Struct({ from: Schema.String, signal: WakeSignal }));
const decodeEnvelope = Schema.decodeUnknownOption(Envelope);
const encodeEnvelope = Schema.encodeSync(Envelope);

/** How a driver listens on the channel and sends to it. */
type Channel = {
  /** The payloads of the channel, from the time that `LISTEN` holds. */
  readonly listen: Effect.Effect<Stream.Stream<string, unknown>, unknown, Scope.Scope>;
  readonly notify: (payload: string) => Effect.Effect<void, unknown>;
};

/**
 * The wake over a database channel, with `LISTEN` and `NOTIFY`. Each process
 * gets its own ID, and drops the signals that it sent. The listener runs for
 * the life of the layer. When the connection drops, it listens again after a
 * second, and says `listening`, because signals sent in between are lost.
 * `sendOnCommit` sends with `pg_notify` through the transaction, so the
 * signal goes out only when the transaction commits. Both drivers do this.
 */
function wakeOver(over: Channel) {
  return Effect.gen(function* () {
    const self = crypto.randomUUID();
    const heard = yield* PubSub.unbounded<WakeSignal>();
    const listenOnce = Effect.scoped(
      Effect.gen(function* () {
        const payloads = yield* over.listen;
        yield* PubSub.publish(heard, { kind: 'listening' });
        yield* Stream.runForEach(payloads, (payload) =>
          Option.match(decodeEnvelope(payload), {
            onNone: () => Effect.logWarning('The sync wake got a payload that it cannot read'),
            onSome: ({ from, signal }) =>
              from === self ? Effect.void : PubSub.publish(heard, signal),
          }),
        );
      }),
    );
    yield* listenOnce.pipe(
      Effect.tapCause((cause) => Effect.logWarning('The sync wake stopped listening', cause)),
      Effect.ignore,
      Effect.repeat(Schedule.spaced('1 second')),
      Effect.forkScoped,
    );
    return Wake.of({
      send: (signal) => over.notify(encodeEnvelope({ from: self, signal })),
      sendOnCommit: (tx, signal) =>
        tx.execute(sql`select pg_notify(${channel}, ${encodeEnvelope({ from: self, signal })})`),
      signals: Stream.fromPubSub(heard),
    });
  });
}

/** The wake over a Postgres server. Each process of the server hears the others. */
export const WakePostgres = Layer.effect(Wake)(
  Effect.gen(function* () {
    const client = yield* PgClient.PgClient;
    return yield* wakeOver({
      listen: Effect.map(client.listen(channel), (queue) =>
        Stream.fromQueue(queue).pipe(Stream.map((notification) => notification.payload)),
      ),
      notify: (payload) => client.notify(channel, payload),
    });
  }),
);

/**
 * The wake over PGlite. PGlite runs in one process, so only the event logs and
 * the sessions of that process hear it. Tests use it to run two event logs
 * over one database.
 */
export const WakePglite = Layer.effect(Wake)(
  Effect.gen(function* () {
    const client = yield* PgliteClient.PgliteClient;
    return yield* wakeOver({
      listen: Effect.map(client.listen(channel), (queue) => Stream.fromQueue(queue)),
      notify: (payload) => client.notify(channel, payload),
    });
  }),
);
