import { expect, test } from 'bun:test';

import { DatabasePostgres } from '@repo/sync/runtime/database.server';
import { Database } from '@repo/sync/service/database';
import { Wake } from '@repo/sync/service/wake';
import { describeOnPostgres, freshDatabase } from '@repo/sync/testing/postgres';
import { Context, Deferred, Effect, Fiber, Layer, Stream } from 'effect';

describeOnPostgres('the wake on a real Postgres server', (serverUrl) => {
  test('a signal sent in a transaction reaches another process when it commits, and not when it rolls back', async () => {
    const heard = await Effect.runPromise(
      Effect.gen(function* () {
        const urlOf = yield* freshDatabase(serverUrl);
        // Two processes, each with its own pool and its own LISTEN connection.
        const first = yield* Layer.build(DatabasePostgres(urlOf('first')));
        const second = yield* Layer.build(DatabasePostgres(urlOf('second')));
        const db = Context.get(first, Database);
        const sender = Context.get(first, Wake);
        const hearer = Context.get(second, Wake);
        const send = (organizationId: string, after: Effect.Effect<void, string>) =>
          db.transaction((tx) =>
            sender.sendOnCommit(tx, { kind: 'commit', organizationId }).pipe(Effect.andThen(after)),
          );
        const listening = yield* Deferred.make<true>();
        const reading = yield* hearer.signals.pipe(
          Stream.flatMap((signal) =>
            Stream.fromIterable(signal.kind === 'commit' ? [signal.organizationId] : []),
          ),
          Stream.tap((id) => (id === 'probe' ? Deferred.succeed(listening, true) : Effect.void)),
          Stream.filter((id) => id !== 'probe'),
          Stream.takeUntil((id) => id === 'kept'),
          Stream.runCollect,
          Effect.forkChild,
        );
        // The hearer listens on its own fiber, so the test sends probes until it hears one.
        yield* send('probe', Effect.void).pipe(
          Effect.andThen(Effect.sleep('20 millis')),
          Effect.andThen(Deferred.isDone(listening)),
          Effect.repeat({ until: (done) => done }),
        );
        yield* Effect.flip(send('rolled', Effect.fail('roll back')));
        yield* send('kept', Effect.void);
        return yield* Fiber.join(reading);
      }).pipe(Effect.scoped),
    );
    expect(heard).toEqual(['kept']);
  }, 20_000);
});
