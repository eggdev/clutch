import { expect, test } from 'bun:test';

import { SyncRpcs, transactionsPerPush } from '@repo/sync/types/protocol';
import type { SyncMessage } from '@repo/sync/types/protocol';
import { Effect, Exit, Stream } from 'effect';
import { RpcClient } from 'effect/rpc';

import { socketClient, syncUrl, testServer } from '@/test/socket';

/** `count` create-note transactions, with note IDs that start with `prefix`. */
const creates = (prefix: string, count: number) =>
  Array.from({ length: count }, (_, index) => ({
    id: `t-${prefix}${index}`,
    command: 'notes/create',
    input: {
      id: `${prefix}${index}`,
      spaceId: 'general',
      title: `${prefix}${index}`,
      at: '2026-10-28T12:00:00.000Z',
    },
  }));

/** The IDs of the records in the snapshot of a `Groups` message. */
const backfillIds = (message: SyncMessage | undefined) =>
  message?._tag === 'Groups'
    ? message.backfill.flatMap((delta) => delta.changes.map((change) => change.id))
    : [];

test('the server refuses a push of more transactions than a client sends, and applies none of them', async () => {
  const result = await Effect.runPromise(
    Effect.gen(function* () {
      const url = yield* syncUrl;
      return yield* Effect.gen(function* () {
        const rpc = yield* RpcClient.make(SyncRpcs);
        const tooMany = yield* Effect.exit(
          rpc.Push({ transactions: creates('over-', transactionsPerPush + 1) }),
        );
        const fits = yield* rpc.Push({ transactions: creates('fit-', transactionsPerPush) });
        const [opening] = yield* rpc
          .Pull({ lastSyncId: 0, groups: ['space:general'] })
          .pipe(Stream.take(1), Stream.runCollect);
        return { tooMany, fits, notes: backfillIds(opening) };
      }).pipe(Effect.scoped, Effect.provide(socketClient(url)));
    }).pipe(Effect.provide(testServer)),
  );
  expect(Exit.isFailure(result.tooMany)).toBe(true);
  expect(result.notes.filter((id) => id.startsWith('over-'))).toEqual([]);
  // A push of the most that a client sends applies each of its transactions.
  expect(result.fits.map((outcome) => outcome.status)).toEqual(
    Array.from({ length: transactionsPerPush }, () => 'accepted'),
  );
  expect(result.notes.filter((id) => id.startsWith('fit-'))).toHaveLength(transactionsPerPush);
}, 30_000);
