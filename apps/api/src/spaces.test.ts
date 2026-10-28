import { expect, test } from 'bun:test';

import { SyncRpcs } from '@repo/sync/types/protocol';
import type { SyncMessage } from '@repo/sync/types/protocol';
import { Effect, Fiber, Stream } from 'effect';
import type { Scope } from 'effect';
import { RpcClient } from 'effect/rpc';

import { socketClient, syncUrl, testServer } from '@/test/socket';

const at = '2026-10-28T12:00:00.000Z';

const note = (id: string, spaceId: string) => ({
  id: `t-${id}`,
  command: 'notes/create',
  input: { id, spaceId, title: id, at },
});

/** A short form of each message: the records it adds, or the loaded groups and the backfill. */
function summary(message: SyncMessage) {
  return message._tag === 'Deltas'
    ? `deltas ${message.deltas.flatMap((delta) => delta.changes.map((change) => change.id)).join(',')}`
    : `groups ${message.loaded.toSorted().join(',')} backfill ${message.backfill.flatMap((delta) => delta.changes.map((change) => change.id)).join(',')}`;
}

test('two users in different spaces get only the records of their groups', async () => {
  const result = await Effect.runPromise(
    Effect.gen(function* () {
      const url = yield* syncUrl;
      const asUser = <A, E>(
        userId: string,
        body: Effect.Effect<A, E, RpcClient.Protocol | Scope.Scope>,
      ) => body.pipe(Effect.scoped, Effect.provide(socketClient(url, userId)));
      const push = (userId: string, transaction: ReturnType<typeof note> | object) =>
        asUser(
          userId,
          Effect.flatMap(RpcClient.make(SyncRpcs), (rpc) =>
            rpc.Push({ transactions: [transaction as never] }),
          ),
        );
      // User A makes a space before user B connects.
      yield* push('user-a', {
        id: 't-space',
        command: 'access/create-space',
        input: { id: 'design', name: 'Design', at },
      });
      return yield* asUser(
        'user-b',
        Effect.gen(function* () {
          const rpc = yield* RpcClient.make(SyncRpcs);
          const reading = yield* rpc
            .Pull({ lastSyncId: 0, groups: ['space:general', 'space:design'] })
            .pipe(
              Stream.takeUntil(
                (message) => message._tag === 'Groups' && message.loaded.includes('space:design'),
              ),
              Stream.runCollect,
              Effect.forkChild,
            );
          yield* Effect.sleep('100 millis');
          yield* push('user-a', note('secret', 'design'));
          yield* push('user-a', note('hello', 'general'));
          yield* Effect.sleep('100 millis');
          const refused = yield* rpc.Load({ group: 'space:design' }).pipe(Effect.flip);
          yield* push('user-b', {
            id: 't-join',
            command: 'access/join-space',
            input: { spaceId: 'design', at },
          });
          yield* Effect.sleep('100 millis');
          yield* rpc.Load({ group: 'space:design' });
          const messages = yield* Fiber.join(reading).pipe(Effect.timeout('3 seconds'));
          return { refused, messages };
        }),
      );
    }).pipe(Effect.provide(testServer)),
  );
  expect(result.refused).toMatchObject({ _tag: 'GroupNotAllowed', group: 'space:design' });
  const summaries = result.messages.map(summary);
  // B loads its organization, its user group and the general space. It may not load design.
  expect(summaries[0]).toBe('groups org:org-test,space:general,user:user-b backfill ');
  // B sees the space record and the general note, never the design note while outside.
  const seen = result.messages.flatMap((message) =>
    message._tag === 'Deltas'
      ? message.deltas.flatMap((delta) => delta.changes.map((change) => change.id))
      : [],
  );
  expect(seen).toContain('design');
  expect(seen).toContain('hello');
  expect(seen).not.toContain('secret');
  // After B joins, loading design sends its past notes as the backfill.
  expect(summaries.at(-1)).toBe(
    'groups org:org-test,space:design,space:general,user:user-b backfill secret',
  );
});
