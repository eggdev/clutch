import { expect, test } from 'bun:test';

import { BunHttpServer } from '@effect/platform-bun';
import { ActorsTest } from '@repo/identity/testing/actor';
import { createNote } from '@repo/notes/contract/notes';
import { notesClient } from '@repo/notes/runtime/client';
import { WebhookSignatureTest } from '@repo/notes/testing/webhook';
import { trimLogJob } from '@repo/sync/jobs/trim-log';
import { DatabasePglite } from '@repo/sync/runtime/database.server';
import { createPool } from '@repo/sync/runtime/pool';
import { engine } from '@repo/sync/runtime/transport';
import { Database } from '@repo/sync/service/database';
import { SyncRpcs } from '@repo/sync/types/protocol';
import { ConfigProvider, Effect, Layer, Schedule, Stream } from 'effect';
import { RpcClient } from 'effect/rpc';

import { api } from '@/server';
import { socketClient, syncUrl } from '@/test/socket';

const at = '2026-10-28T12:00:00.000Z';

/** The whole API over a real socket, with its database open to the test too, so the test can run the trim. */
const server = api(
  Layer.effect(Database)(
    Effect.gen(function* () {
      return yield* Database;
    }),
  ),
).pipe(
  Layer.provide(ActorsTest()),
  Layer.provide(WebhookSignatureTest),
  Layer.provideMerge(DatabasePglite()),
  Layer.provideMerge(BunHttpServer.layerTest),
);

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
