import { expect, test } from 'bun:test';

import { createNote } from '@repo/notes/contract/notes';
import { notesClient } from '@repo/notes/runtime/client';
import { trimLogJob } from '@repo/sync/jobs/trim-log';
import { createPool } from '@repo/sync/runtime/pool';
import { engine } from '@repo/sync/runtime/transport';
import { DatabaseTest } from '@repo/sync/testing/database';
import { SyncRpcs } from '@repo/sync/types/protocol';
import { ConfigProvider, Effect, Layer, Schedule, Stream } from 'effect';
import { RpcClient } from 'effect/rpc';

import { apiProcess, socketClient, syncUrl } from '@/test/socket';

const at = '2026-10-28T12:00:00.000Z';

/** The whole API over a real socket, with its database open to the test too, so the test can run the trim. */
const server = apiProcess().pipe(Layer.provideMerge(DatabaseTest()));

const note = (id: string) => ({
  id: `t-${id}`,
  command: 'notes/create',
  input: { id, spaceId: 'general', title: id, at },
});

function sessionStays() {
  // The session does not end in this test.
}

test('a client behind the trimmed log loads again, ends with each record and keeps its waiting write', async () => {
  const pool = createPool(notesClient.localChanges, notesClient.contract);
  // The saved copy of the client: it holds data up to sync ID 1, with a note that the server never had.
  pool.load({
    lastSyncId: 1,
    groups: ['space:general'],
    tables: {
      Note: [{ id: 'stale', spaceId: 'general', title: 'stale', createdAt: at, updatedAt: at }],
    },
    meta: { 'Note\u0000stale': { groups: ['space:general'], syncId: 1 } },
    pending: [],
  });
  // A write made offline waits in the queue.
  pool.run(createNote, { id: 'n3', spaceId: 'general', title: 'n3', at });
  const notes = () =>
    (pool.snapshot().tables['Note'] ?? []).map((row) => String(row.id)).toSorted();

  const failure = await Effect.runPromise(
    Effect.gen(function* () {
      const url = yield* syncUrl;
      yield* Effect.flatMap(RpcClient.make(SyncRpcs), (rpc) =>
        rpc.Push({ transactions: [note('n1'), note('n2'), note('n4')] }),
      ).pipe(Effect.scoped, Effect.provide(socketClient(url)));
      // A log that keeps 0 days keeps only its newest event, so the client's
      // sync ID 1 is far behind the log.
      yield* trimLogJob
        .execute(
          {},
          {
            jobId: 'sync/trim-log:test',
            organizationId: null,
            attempt: 1,
            commit: () => Effect.die('The trim job commits nothing.'),
          },
        )
        .pipe(
          Effect.provide(
            ConfigProvider.layer(ConfigProvider.fromEnv({ env: { SYNC_LOG_KEEP_DAYS: '0' } })),
          ),
        );
      const behind = yield* Effect.flatMap(RpcClient.make(SyncRpcs), (rpc) =>
        rpc.Pull({ lastSyncId: 1, groups: ['space:general'] }).pipe(Stream.runCollect, Effect.flip),
      ).pipe(Effect.scoped, Effect.provide(socketClient(url)));
      const done = Effect.suspend(() =>
        notes().join(',') === 'n1,n2,n3,n4' && pool.snapshot().pending.length === 0
          ? Effect.void
          : Effect.fail('not yet'),
      ).pipe(Effect.retry(Schedule.spaced('20 millis')), Effect.timeout('10 seconds'));
      yield* Effect.gen(function* () {
        const client = yield* RpcClient.make(SyncRpcs);
        yield* Effect.forkScoped(engine(pool, client, 'digest', sessionStays));
        yield* done;
      }).pipe(Effect.scoped, Effect.provide(socketClient(url)));
      return behind;
    }).pipe(Effect.provide(server)),
  );
  expect(failure).toMatchObject({ _tag: 'ServerBehind' });
  expect(failure._tag === 'ServerBehind' ? failure.oldest : undefined).toBeGreaterThan(2);
  // The stale note is gone, each note of the server is there, and the waiting write reached the server.
  expect(notes()).toEqual(['n1', 'n2', 'n3', 'n4']);
  expect(pool.snapshot().pending).toEqual([]);
}, 30_000);

test('a write that the server accepted, sent again after the trim deleted its event, applies once', async () => {
  const result = await Effect.runPromise(
    Effect.gen(function* () {
      const url = yield* syncUrl;
      const push = (transactions: ReadonlyArray<ReturnType<typeof note>>) =>
        Effect.flatMap(RpcClient.make(SyncRpcs), (rpc) => rpc.Push({ transactions })).pipe(
          Effect.scoped,
          Effect.provide(socketClient(url)),
        );
      // The device saw no delta of n1, so it keeps the write as waiting.
      const [first] = yield* push([note('n1')]);
      yield* push([note('n2'), note('n3')]);
      yield* trimLogJob
        .execute(
          {},
          {
            jobId: 'sync/trim-log:test',
            organizationId: null,
            attempt: 1,
            commit: () => Effect.die('The trim job commits nothing.'),
          },
        )
        .pipe(
          Effect.provide(
            ConfigProvider.layer(ConfigProvider.fromEnv({ env: { SYNC_LOG_KEEP_DAYS: '0' } })),
          ),
        );
      // After `ServerBehind`, the client sends each waiting write again.
      const [again] = yield* push([note('n1')]);
      const head = yield* Effect.flatMap(RpcClient.make(SyncRpcs), (rpc) =>
        rpc.Pull({ lastSyncId: 0, groups: ['space:general'] }).pipe(
          Stream.filter((message) => message._tag === 'Deltas'),
          Stream.take(1),
          Stream.runCollect,
        ),
      ).pipe(Effect.scoped, Effect.provide(socketClient(url)));
      return { first, again, head: head[0]?._tag === 'Deltas' ? head[0].deltas[0]?.syncId : 0 };
    }).pipe(Effect.provide(server)),
  );
  expect(result.first?.status).toBe('accepted');
  expect(result.again).toEqual(result.first);
  // No second event: the head is still the event of n2 and n3.
  expect(result.head).toBe(3);
}, 30_000);
