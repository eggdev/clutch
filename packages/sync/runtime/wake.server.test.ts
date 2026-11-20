import { expect, test } from 'bun:test';

import { WakePglite } from '@repo/sync/runtime/wake.server';
import { Database } from '@repo/sync/service/database';
import { Wake } from '@repo/sync/service/wake';
import { DatabaseTest } from '@repo/sync/testing/database';
import { Context, Deferred, Effect, Fiber, Layer, Stream } from 'effect';

test('a signal sent in a transaction goes out when it commits, and not when it rolls back', async () => {
  const heard = await Effect.runPromise(
    Effect.gen(function* () {
      const db = yield* Database;
      const sender = Context.get(yield* Layer.build(Layer.fresh(WakePglite)), Wake);
      const hearer = Context.get(yield* Layer.build(Layer.fresh(WakePglite)), Wake);
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
      // The hearer listens on its own fiber, so the test sends until it hears one.
      yield* send('probe', Effect.void).pipe(
        Effect.andThen(Deferred.await(listening).pipe(Effect.timeout('100 millis'))),
        Effect.retry({ times: 20 }),
      );
      yield* Effect.flip(send('rolled', Effect.fail('roll back')));
      yield* send('kept', Effect.void);
      return yield* Fiber.join(reading).pipe(Effect.timeout('5 seconds'));
    }).pipe(Effect.scoped, Effect.provide(DatabaseTest())),
  );
  expect(heard).toEqual(['kept']);
});
