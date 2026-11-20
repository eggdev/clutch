import { expect, test } from 'bun:test';

import { defineContract } from '@repo/sync/contract/define';
import { organizationGroup } from '@repo/sync/contract/engine-groups';
import { record } from '@repo/sync/contract/record';
import { createPool } from '@repo/sync/runtime/pool';
import type { Pool } from '@repo/sync/runtime/pool';
import { EventLog, eventLog } from '@repo/sync/service/event-log';
import { feed } from '@repo/sync/service/feed';
import type { LoadRequest } from '@repo/sync/service/feed';
import { DatabaseTest } from '@repo/sync/testing/database';
import type { Change, SyncMessage } from '@repo/sync/types/protocol';
import { Effect, Layer, Queue, Stream } from 'effect';
import type { Context } from 'effect';

/** A card of the organization, so each change of `Card` fits a declared record. */
const cardRecord = record('Card', {
  fields: { id: 'string', title: 'string' },
  groups: [organizationGroup.ofScope],
});
const cards = defineContract('cards', { records: [cardRecord], commands: [], loads: [] });

const upsert = (id: string, groups: ReadonlyArray<string>, title = id): Change => ({
  model: 'Card',
  id,
  action: 'upsert',
  data: { id, title },
  groups,
});

const remove = (id: string, groups: ReadonlyArray<string>): Change => ({
  model: 'Card',
  id,
  action: 'delete',
  data: { id, title: id },
  groups,
});

/** Records per page in these tests, so a few records make several pages. */
const pageSize = 1;

function run<A, E>(program: Effect.Effect<A, E, EventLog>) {
  return Effect.runPromise(
    program.pipe(
      Effect.provide(eventLog([cards], { pageSize }).pipe(Layer.provide(DatabaseTest()))),
    ),
  );
}

type Log = Context.Service.Shape<typeof EventLog>;

/** Applies one message to the pool, as the transport does. */
function apply(pool: Pool, message: SyncMessage) {
  if (message._tag === 'Deltas') {
    pool.applyDeltas(message.deltas);
  } else if (message._tag === 'Page') {
    pool.applyPage(message.group, message.backfill);
  } else {
    pool.applyGroups(message.loaded, message.backfill);
  }
}

/** The feed of user `u` in `org-a`, which may load every group of these tests. */
function open(
  log: Log,
  options: { readonly loaded: ReadonlyArray<string>; readonly lastSyncId?: number },
  requests: Queue.Queue<LoadRequest>,
) {
  return feed(log, {
    organizationId: 'org-a',
    userId: 'u',
    lastSyncId: options.lastSyncId ?? 0,
    loaded: options.loaded,
    pages: true,
    granted: Effect.succeed({ eager: ['org:a'], lazy: ['space:x', 'space:y'] }),
    requests,
  });
}

/** The cards that the pool holds, as `id title`. */
const held = (pool: Pool) =>
  pool
    .snapshot()
    .tables['Card']?.map((row) => `${row.id} ${String(row.title)}`)
    .toSorted();

test('a group load sends each live record once with its last change, whatever its history', async () => {
  const pages = await run(
    Effect.gen(function* () {
      const log = yield* EventLog;
      for (let edit = 1; edit <= 30; edit += 1) {
        yield* log.commit('org-a', `t-a-${edit}`, () =>
          Effect.succeed([upsert('a', ['space:x'], `a${edit}`)]),
        );
      }
      yield* log.commit('org-a', 't-b', () => Effect.succeed([upsert('b', ['space:x'])]));
      yield* log.commit('org-a', 't-b-gone', () => Effect.succeed([remove('b', ['space:x'])]));
      yield* log.commit('org-a', 't-c', () => Effect.succeed([upsert('c', ['space:x'])]));
      return yield* Stream.runCollect(log.snapshot('org-a', 'space:x'));
    }),
  );
  // One record a page: a, then c, then an empty last page. b is deleted, so it is not sent.
  expect(pages.map((page) => page.more)).toEqual([true, true, false]);
  expect(pages.flatMap((page) => page.deltas)).toEqual([
    { syncId: 30, transactionId: null, changes: [upsert('a', ['space:x'], 'a30')] },
    { syncId: 33, transactionId: null, changes: [upsert('c', ['space:x'])] },
  ]);
});

test('a record in a group that the load reads before comes once', async () => {
  const deltas = await run(
    Effect.gen(function* () {
      const log = yield* EventLog;
      yield* log.commit('org-a', 't-a', () => Effect.succeed([upsert('a', ['org:a', 'space:x'])]));
      yield* log.commit('org-a', 't-b', () => Effect.succeed([upsert('b', ['space:x'])]));
      const pages = yield* Stream.runCollect(log.snapshot('org-a', 'space:x', new Set(['org:a'])));
      return pages.flatMap((page) => page.deltas);
    }),
  );
  expect(deltas.flatMap((delta) => delta.changes.map((change) => change.id))).toEqual(['b']);
});

test('a client at sync ID 0 gets the snapshot of its groups, then an empty delta at the head', async () => {
  const messages = await run(
    Effect.gen(function* () {
      const log = yield* EventLog;
      yield* log.commit('org-a', 't-a', () => Effect.succeed([upsert('a', ['org:a'])]));
      yield* log.commit('org-a', 't-a2', () => Effect.succeed([upsert('a', ['org:a'], 'a2')]));
      yield* log.commit('org-a', 't-y', () => Effect.succeed([upsert('y', ['space:y'])]));
      const requests = yield* Queue.unbounded<LoadRequest>();
      return yield* open(log, { loaded: ['org:a'] }, requests).pipe(
        Stream.take(4),
        Stream.runCollect,
        Effect.timeout('2 seconds'),
      );
    }),
  );
  expect(messages).toEqual([
    // The first message names the actor of the connection, before any page.
    // It loads no group yet: a group loads with its last page.
    {
      _tag: 'Groups',
      loaded: [],
      backfill: [],
      actor: { userId: 'u', organizationId: 'org-a' },
    },
    {
      _tag: 'Page',
      group: 'org:a',
      backfill: [{ syncId: 2, transactionId: null, changes: [upsert('a', ['org:a'], 'a2')] }],
    },
    { _tag: 'Groups', loaded: ['org:a'], backfill: [] },
    // The head is 3, so the next pull of the client starts after the event of space y.
    { _tag: 'Deltas', deltas: [{ syncId: 3, transactionId: null, changes: [] }] },
  ]);
});

/**
 * The log, with `between` run once, after the first page of a snapshot that
 * holds a record and before the next page is read.
 */
function pausedAfterFirstPage(log: Log, between: Effect.Effect<unknown, unknown>): Log {
  let paused = false;
  return {
    ...log,
    snapshot: (organizationId, group, skip) =>
      log.snapshot(organizationId, group, skip).pipe(
        Stream.tap((page) => {
          if (paused || page.deltas.length === 0) {
            return Effect.void;
          }
          paused = true;
          return between;
        }),
      ),
  };
}

/**
 * Cards a, b and c are in space x, and z is in space y. After the first page,
 * which holds a: a and b change, c is deleted, z moves into space x, and a new
 * card 0 enters space x before the cursor.
 */
const changesBetweenPages = (log: Log) => ({
  before: Effect.gen(function* () {
    for (const id of ['a', 'b', 'c']) {
      yield* log.commit('org-a', `t-${id}`, () => Effect.succeed([upsert(id, ['space:x'])]));
    }
    yield* log.commit('org-a', 't-z', () => Effect.succeed([upsert('z', ['space:y'])]));
  }),
  between: Effect.gen(function* () {
    yield* log.commit('org-a', 't-a2', () => Effect.succeed([upsert('a', ['space:x'], 'a2')]));
    yield* log.commit('org-a', 't-b2', () => Effect.succeed([upsert('b', ['space:x'], 'b2')]));
    yield* log.commit('org-a', 't-c-gone', () => Effect.succeed([remove('c', ['space:x'])]));
    yield* log.commit('org-a', 't-z-in', () => Effect.succeed([upsert('z', ['space:x'])]));
    yield* log.commit('org-a', 't-0', () => Effect.succeed([upsert('0', ['space:x'])]));
  }),
});

/** The last sync ID after the changes between the pages. */
const lastChange = 9;

/** The cards that a client of space x ends with. */
const endState = ['0 0', 'a a2', 'b b2', 'z z'];

/** The records of each `Page` message, as `id title`. */
const pageRecords = (messages: ReadonlyArray<SyncMessage>) =>
  messages.flatMap((message) =>
    message._tag === 'Page'
      ? [
          message.backfill
            .flatMap((delta) => delta.changes)
            .map((item) => `${item.id} ${String(item.data?.['title'])}`)
            .join(','),
        ]
      : [],
  );

test('a client at sync ID 0 ends right when records change, leave and enter between two pages', async () => {
  const pool = createPool([], { records: [cardRecord], commands: [] });
  const messages = await run(
    Effect.gen(function* () {
      const log = yield* EventLog;
      const steps = changesBetweenPages(log);
      yield* steps.before;
      const requests = yield* Queue.unbounded<LoadRequest>();
      return yield* open(
        pausedAfterFirstPage(log, steps.between),
        { loaded: ['org:a', 'space:x'] },
        requests,
      ).pipe(
        Stream.tap((message) => Effect.sync(() => apply(pool, message))),
        Stream.takeUntil(() => pool.lastSyncId() >= lastChange),
        Stream.runCollect,
        Effect.timeout('2 seconds'),
      );
    }),
  );
  // The pages after the first one read the new state: b changed, c is gone,
  // and z came in. Card 0 is before the cursor, so only its live delta brings it.
  expect(pageRecords(messages)).toEqual(['a a', 'b b2', 'z z']);
  expect(held(pool)).toEqual(endState);
  expect(pool.loadedGroups().toSorted()).toEqual(['org:a', 'space:x']);
});

test('a client that loads a group ends right when records change, leave and enter between two pages', async () => {
  const pool = createPool([], { records: [cardRecord], commands: [] });
  await run(
    Effect.gen(function* () {
      const log = yield* EventLog;
      const steps = changesBetweenPages(log);
      yield* steps.before;
      const requests = yield* Queue.unbounded<LoadRequest>();
      yield* Queue.offer(requests, { group: 'space:x', pages: true });
      yield* open(
        pausedAfterFirstPage(log, steps.between),
        { loaded: ['org:a'], lastSyncId: 4 },
        requests,
      ).pipe(
        Stream.tap((message) => Effect.sync(() => apply(pool, message))),
        Stream.takeUntil(() => pool.lastSyncId() >= lastChange),
        Stream.runDrain,
        Effect.timeout('2 seconds'),
      );
    }),
  );
  expect(held(pool)).toEqual(endState);
  expect(pool.loadedGroups().toSorted()).toEqual(['org:a', 'space:x']);
});
