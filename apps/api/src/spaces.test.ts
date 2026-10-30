import { expect, test } from 'bun:test';

import { SyncRpcs } from '@repo/sync/types/protocol';
import type { SyncMessage } from '@repo/sync/types/protocol';
import { Deferred, Effect, Fiber, Stream } from 'effect';
import type { Scope } from 'effect';
import { RpcClient } from 'effect/rpc';

import { socketClient, syncUrl, testServer } from '@/test/socket';

const at = '2026-10-28T12:00:00.000Z';

const note = (id: string, spaceId: string) => ({
  id: `t-${id}`,
  command: 'notes/create',
  input: { id, spaceId, title: id, at },
});

/** The changes in one message. A Groups message holds none outside its backfill. */
const changesOf = (message: SyncMessage) =>
  message._tag === 'Deltas' ? message.deltas.flatMap((delta) => delta.changes) : [];

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
      // The note count is a job that runs after each note. Wait until user A, a
      // member of design, sees the design count, so it is in B's backfill every time.
      const countWritten = asUser(
        'user-a',
        Effect.gen(function* () {
          const rpc = yield* RpcClient.make(SyncRpcs);
          yield* rpc.Pull({ lastSyncId: 0, groups: ['space:design'] }).pipe(
            Stream.takeUntil((message) =>
              changesOf(message).some(
                (change) => change.model === 'SpaceNoteCount' && change.id === 'design',
              ),
            ),
            Stream.runDrain,
            Effect.timeout('3 seconds'),
          );
        }),
      );
      return yield* asUser(
        'user-b',
        Effect.gen(function* () {
          const rpc = yield* RpcClient.make(SyncRpcs);
          const connected = yield* Deferred.make<boolean>();
          const sawHello = yield* Deferred.make<boolean>();
          const sawJoin = yield* Deferred.make<boolean>();
          const reading = yield* rpc
            .Pull({ lastSyncId: 0, groups: ['space:general', 'space:design'] })
            .pipe(
              Stream.tap((message) =>
                Effect.gen(function* () {
                  yield* Deferred.succeed(connected, true);
                  const changes = changesOf(message);
                  if (changes.some((change) => change.id === 'hello')) {
                    yield* Deferred.succeed(sawHello, true);
                  }
                  if (changes.some((change) => change.model === 'Membership')) {
                    yield* Deferred.succeed(sawJoin, true);
                  }
                }),
              ),
              Stream.takeUntil(
                (message) => message._tag === 'Groups' && message.loaded.includes('space:design'),
              ),
              Stream.runCollect,
              Effect.forkChild,
            );
          // The first message comes after the subscription, so no later push can be missed.
          yield* Deferred.await(connected);
          yield* push('user-a', note('secret', 'design'));
          yield* push('user-a', note('hello', 'general'));
          // Events arrive in order, so B has seen the secret note's event once hello arrives.
          yield* Deferred.await(sawHello);
          yield* countWritten;
          const refused = yield* rpc.Load({ group: 'space:design' }).pipe(Effect.flip);
          yield* push('user-b', {
            id: 't-join',
            command: 'access/join-space',
            input: { spaceId: 'design', at },
          });
          // The membership change makes the server ask access again, so B may load design.
          yield* Deferred.await(sawJoin);
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
  // After B joins, loading design sends the group's past changes as the backfill:
  // the secret note, then the design note count that the job wrote after it.
  expect(summaries.at(-1)).toBe(
    'groups org:org-test,space:design,space:general,user:user-b backfill secret,design',
  );
});
