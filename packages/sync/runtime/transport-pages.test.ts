import { expect, test } from 'bun:test';

import { createPool } from '@repo/sync/runtime/pool';
import { engine } from '@repo/sync/runtime/transport';
import { testModel, testStamps } from '@repo/sync/testing/pool-state';
import { SyncRpcs } from '@repo/sync/types/protocol';
import type { SyncMessage } from '@repo/sync/types/protocol';
import { Effect, Queue, Schedule, Schema, Stream } from 'effect';
import { RpcTest } from 'effect/rpc';

/**
 * The backfill pages of the engine, against handlers in memory: the keys
 * that ask for pages, and a socket that drops between two pages.
 */

const card = testModel('Card', { id: 'string', title: 'string' });
const declared = { records: [card], commands: [] };

type PullCall = { readonly lastSyncId: number; readonly groups: ReadonlyArray<string> };

function sessionStays() {
  // No test ends the session.
}

/** A change of card `id` in space x. */
const inSpace = (id: string, syncId: number) => ({
  syncId,
  transactionId: null,
  changes: [
    {
      model: 'Card',
      id,
      action: 'upsert' as const,
      data: { id, title: id },
      groups: ['space:x'],
    },
  ],
});

test('a client that drops between two pages loads the whole group again on the next pull', async () => {
  const pool = createPool([], declared, { stamps: testStamps() });
  const gate = pool.loadGroup('space:x');
  const pulls: Array<PullCall> = [];
  const asked: Array<{ group: string; pages: boolean | undefined }> = [];
  const loads = Effect.runSync(Queue.unbounded<string>());
  const handlers = SyncRpcs.toLayer({
    Push: () => Effect.succeed([]),
    Pull: (call) => {
      pulls.push({ lastSyncId: call.lastSyncId, groups: call.groups });
      const first = pulls.length === 1;
      const opened = Stream.make<Array<SyncMessage>>({
        _tag: 'Groups',
        loaded: ['org:a'],
        backfill: [],
      });
      const afterLoad = Stream.unwrap(
        Effect.map(Queue.take(loads), (): Stream.Stream<SyncMessage> =>
          first
            ? Stream.concat(
                Stream.make<Array<SyncMessage>>({
                  _tag: 'Page',
                  group: 'space:x',
                  backfill: [inSpace('a', 1)],
                }),
                Stream.die('The socket dropped.'),
              )
            : Stream.concat(
                Stream.make<Array<SyncMessage>>(
                  { _tag: 'Page', group: 'space:x', backfill: [inSpace('a', 1)] },
                  { _tag: 'Groups', loaded: ['org:a', 'space:x'], backfill: [inSpace('b', 2)] },
                ),
                Stream.never,
              ),
        ),
      );
      return Stream.concat(opened, afterLoad);
    },
    Load: ({ group, pages }) =>
      Effect.gen(function* () {
        asked.push({ group, pages });
        yield* Queue.offer(loads, group);
      }),
  });
  let loaded = false;
  void gate.then(() => {
    loaded = true;
  });
  await Effect.runPromise(
    Effect.gen(function* () {
      const client = yield* RpcTest.makeClient(SyncRpcs);
      yield* Effect.forkScoped(engine(pool, client, 'digest', sessionStays));
      yield* Effect.suspend(() => (loaded ? Effect.void : Effect.fail('not yet'))).pipe(
        Effect.retry(Schedule.spaced('10 millis')),
        Effect.timeout('5 seconds'),
      );
    }).pipe(Effect.scoped, Effect.provide(handlers)),
  );
  expect(asked).toEqual([
    { group: 'space:x', pages: true },
    { group: 'space:x', pages: true },
  ]);
  // The second pull does not name the group whose pages stopped half way.
  expect(pulls.map((call) => call.groups)).toEqual([[], ['org:a']]);
  expect(pool.loadedGroups().toSorted()).toEqual(['org:a', 'space:x']);
  expect(pool.ids(card).toSorted()).toEqual(['a', 'b']);
});

test('an older server reads a load that asks for pages, and a newer one reads a load without it', () => {
  const older = Schema.Struct({ group: Schema.String });
  expect(Schema.decodeUnknownSync(older)({ group: 'space:x', pages: true })).toEqual({
    group: 'space:x',
  });
  const load = SyncRpcs.requests.get('Load');
  expect(load && Schema.decodeUnknownSync(load.payloadSchema)({ group: 'space:x' })).toEqual({
    group: 'space:x',
  });
});

test('a pull says that the client reads pages', async () => {
  const pool = createPool([], declared, { stamps: testStamps() });
  const asked: Array<boolean | undefined> = [];
  const handlers = SyncRpcs.toLayer({
    Push: () => Effect.succeed([]),
    Pull: ({ pages }) => {
      asked.push(pages);
      return Stream.never;
    },
    Load: () => Effect.void,
  });
  await Effect.runPromise(
    Effect.gen(function* () {
      const client = yield* RpcTest.makeClient(SyncRpcs);
      yield* Effect.forkScoped(engine(pool, client, 'digest', sessionStays));
      yield* Effect.suspend(() => (asked.length ? Effect.void : Effect.fail('not yet'))).pipe(
        Effect.retry(Schedule.spaced('10 millis')),
        Effect.timeout('5 seconds'),
      );
    }).pipe(Effect.scoped, Effect.provide(handlers)),
  );
  expect(asked).toEqual([true]);
});

/** A change of card `id` in the organization. */
const inOrganization = (id: string, syncId: number) => ({
  ...inSpace(id, syncId),
  changes: inSpace(id, syncId).changes.map((change) => ({ ...change, groups: ['org:a'] })),
});

test('a pull that names its actor before the first page ends with each record of a part-finished first load', async () => {
  const pool = createPool([], declared, { stamps: testStamps() });
  // A first load was cut off: the copy holds a record at sync ID 0 that the server deleted since.
  pool.load({
    lastSyncId: 0,
    groups: [],
    tables: { Card: [{ id: 'gone', title: 'gone' }] },
    meta: { 'Card\u0000gone': { groups: ['org:a'], syncId: 1 } },
    pending: [],
  });
  const handlers = SyncRpcs.toLayer({
    Push: () => Effect.succeed([]),
    // The server names the actor first, with no group loaded yet, then sends the pages.
    Pull: () =>
      Stream.concat(
        Stream.make<Array<SyncMessage>>(
          {
            _tag: 'Groups',
            loaded: [],
            backfill: [],
            actor: { userId: 'u', organizationId: 'a' },
          },
          { _tag: 'Page', group: 'org:a', backfill: [inOrganization('a', 2)] },
          { _tag: 'Groups', loaded: ['org:a'], backfill: [inOrganization('b', 3)] },
          { _tag: 'Deltas', deltas: [{ syncId: 3, transactionId: null, changes: [] }] },
        ),
        Stream.never,
      ),
    Load: () => Effect.void,
  });
  await Effect.runPromise(
    Effect.gen(function* () {
      const client = yield* RpcTest.makeClient(SyncRpcs);
      yield* Effect.forkScoped(engine(pool, client, 'digest', sessionStays));
      yield* Effect.sync(() => pool.lastSyncId()).pipe(
        Effect.repeat({ until: (last) => last === 3, schedule: Schedule.spaced('10 millis') }),
      );
    }).pipe(Effect.scoped, Effect.provide(handlers)),
  );
  expect(pool.loadedGroups()).toEqual(['org:a']);
  expect(pool.ids(card).toSorted()).toEqual(['a', 'b']);
});
