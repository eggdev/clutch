import { expect, test } from 'bun:test';

import { SyncRpcs } from '@repo/sync/types/protocol';
import type { SyncMessage } from '@repo/sync/types/protocol';
import { Deferred, Effect, Fiber, Queue, Stream } from 'effect';
import { RpcClient } from 'effect/rpc';

import { socketClient, syncUrl, testServer } from '@/test/socket';

/**
 * A second `Pull` on one socket, which starts before the first one ended
 * and before its cleanup ran on the server. The server does not wait for
 * the cleanup of a pull that the client interrupts, so the order is
 * possible, and a client that sends two pulls at once always meets it.
 * Each `Load` must reach the newest pull: before the first one ends, and
 * after.
 */

const loads = (message: SyncMessage, group: string) =>
  message._tag === 'Groups' && message.loaded.includes(group);

test('a Load reaches the newest pull of a socket, also after the older pull ends', async () => {
  const result = await Effect.runPromise(
    Effect.gen(function* () {
      const url = yield* syncUrl;
      return yield* Effect.gen(function* () {
        const rpc = yield* RpcClient.make(SyncRpcs);
        const first = yield* Queue.unbounded<SyncMessage>();
        const second = yield* Queue.unbounded<SyncMessage>();
        const open = (seen: Queue.Queue<SyncMessage>) =>
          rpc.Pull({ lastSyncId: 0, groups: [], pages: true }).pipe(
            Stream.runForEach((message) => Queue.offer(seen, message)),
            Effect.forkChild,
          );
        const older = yield* open(first);
        // Each pull registers its queue before its first message.
        yield* Queue.take(first);
        yield* open(second);
        yield* Queue.take(second);
        const loadedBy = yield* Deferred.make<'older' | 'newer'>();
        const watch = (seen: Queue.Queue<SyncMessage>, which: 'older' | 'newer') =>
          Queue.take(seen).pipe(
            Effect.repeat({ until: (message) => loads(message, 'space:general') }),
            Effect.andThen(Deferred.succeed(loadedBy, which)),
            Effect.forkChild,
          );
        const watchers = [yield* watch(first, 'older'), yield* watch(second, 'newer')];
        yield* rpc.Load({ group: 'space:general', pages: true });
        const whileBoth = yield* Deferred.await(loadedBy).pipe(
          Effect.timeoutOrElse({ duration: '3 seconds', orElse: () => Effect.succeed('none') }),
        );
        yield* Fiber.interruptAll(watchers);
        // The older pull ends, and its cleanup runs on the server.
        yield* Fiber.interrupt(older);
        yield* Effect.sleep('200 millis');
        // A group that is loaded already answers with a `Groups` message that names it.
        const afterEnd = yield* rpc.Load({ group: 'space:general', pages: true }).pipe(
          Effect.andThen(
            Queue.take(second).pipe(
              Effect.repeat({ until: (message) => loads(message, 'space:general') }),
            ),
          ),
          Effect.as('newer'),
          Effect.timeoutOrElse({
            duration: '3 seconds',
            orElse: () => Effect.succeed('the load waits'),
          }),
        );
        return { whileBoth, afterEnd };
      }).pipe(Effect.scoped, Effect.provide(socketClient(url)));
    }).pipe(Effect.provide(testServer)),
  );
  expect(result).toEqual({ whileBoth: 'newer', afterEnd: 'newer' });
}, 30_000);
