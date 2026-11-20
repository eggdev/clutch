import { expect, test } from 'bun:test';

import { SyncRpcs } from '@repo/sync/types/protocol';
import type { SyncMessage } from '@repo/sync/types/protocol';
import { Effect, Stream } from 'effect';
import { RpcClient } from 'effect/rpc';

import { socketClient, syncUrl, testServer } from '@/test/socket';

const at = '2026-10-28T12:00:00.000Z';

/** The IDs of the records in the backfill of a `Groups` message. */
const backfillIds = (message: SyncMessage | undefined) =>
  message?._tag === 'Groups'
    ? message.backfill.flatMap((delta) => delta.changes.map((change) => change.id))
    : [];

test('a client past sync ID 0 gets the history of an eager group that it did not name', async () => {
  const [unnamed, named] = await Effect.runPromise(
    Effect.gen(function* () {
      const url = yield* syncUrl;
      // User A makes a space. The space is in the group of the organization, an eager group.
      const [outcome] = yield* Effect.flatMap(RpcClient.make(SyncRpcs), (rpc) =>
        rpc.Push({
          transactions: [
            {
              id: 't-space',
              command: 'access/create-space',
              input: { id: 'design', name: 'Design', at },
            },
          ],
        }),
      ).pipe(Effect.scoped, Effect.provide(socketClient(url, 'user-a')));
      const lastSyncId = outcome?.syncId ?? 0;
      // User B holds data up to that event, and its saved copy names no eager group.
      const firstMessage = (groups: ReadonlyArray<string>) =>
        Effect.flatMap(RpcClient.make(SyncRpcs), (rpc) =>
          rpc.Pull({ lastSyncId, groups }).pipe(Stream.take(1), Stream.runCollect),
        ).pipe(
          Effect.scoped,
          Effect.provide(socketClient(url, 'user-b')),
          Effect.timeout('3 seconds'),
        );
      return [
        (yield* firstMessage([]))[0],
        (yield* firstMessage(['org:org-test', 'user:user-b']))[0],
      ];
    }).pipe(Effect.provide(testServer)),
  );
  expect(unnamed?._tag === 'Groups' && unnamed.loaded).toContain('org:org-test');
  expect(backfillIds(unnamed)).toContain('design');
  // A client that names each eager group gets no backfill, as before.
  expect(backfillIds(named)).toEqual([]);
}, 30_000);
