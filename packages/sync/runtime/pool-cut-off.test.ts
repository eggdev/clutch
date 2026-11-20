import { expect, test } from 'bun:test';

import { defineContract } from '@repo/sync/contract/define';
import { defineGroup } from '@repo/sync/contract/groups';
import { record } from '@repo/sync/contract/record';
import { loadPool } from '@repo/sync/runtime/boot';
import { createPool } from '@repo/sync/runtime/pool';
import type { Pool } from '@repo/sync/runtime/pool';
import { engine } from '@repo/sync/runtime/transport';
import { memoryLocalDatabase } from '@repo/sync/testing/local-database';
import { testStamps } from '@repo/sync/testing/pool-state';
import { SyncRpcs } from '@repo/sync/types/protocol';
import type { Change, Delta, SyncMessage } from '@repo/sync/types/protocol';
import { Effect, Queue, Schedule, Stream } from 'effect';
import { RpcTest } from 'effect/rpc';

/**
 * A load that was cut off. A record of a group that did not finish loading
 * does not outlive that load: the next load sends the group as it is now, and
 * a record that the server deleted in between is gone.
 */

const card = record('Card', {
  fields: { id: 'string', title: 'string', space: 'string' },
  groups: [defineGroup('space').by('space')],
});
const declared = { records: [card], commands: [] };
const cards = defineContract('cards', { records: [card], commands: [], loads: [] });

const put = (id: string, groups: ReadonlyArray<string>): Change => ({
  model: 'Card',
  id,
  action: 'upsert',
  data: { id, title: id, space: groups[0]?.replace('space:', '') ?? '' },
  groups,
});
const delta = (syncId: number, ...changes: Array<Change>): Delta => ({
  syncId,
  transactionId: null,
  changes,
});

/** Lets each save that waits for a microtask run. */
const settle = () =>
  new Promise((resolve) => {
    setTimeout(resolve, 10);
  });

test('case A: a first load cut off after one page leaves no record that the server deleted', async () => {
  const memory = memoryLocalDatabase();
  const first = await loadPool(memory, [], [cards]);
  first.applyPage('space:x', [delta(1, put('r1', ['space:x']), put('r2', ['space:x']))]);
  await settle();
  // The tab closes before the load ends. On the server, r1 is deleted.
  await first.stop();
  const next = await loadPool(memory, [], [cards]);
  next.applyGroups(['space:x'], [delta(2, put('r2', ['space:x']))]);
  next.applyDeltas([delta(3)]);
  await settle();
  expect(next.ids(card)).toEqual(['r2']);
  const saved = await memory.read();
  expect(saved?.tables.Card?.map(({ id }) => id)).toEqual(['r2']);
});

test('a save never writes a record that is in no loaded group', async () => {
  const memory = memoryLocalDatabase();
  const pool = await loadPool(memory, [], [cards]);
  pool.applyGroups(['space:y'], [delta(1, put('k', ['space:y']))]);
  pool.applyPage('space:x', [
    delta(2, put('r1', ['space:x']), put('both', ['space:x', 'space:y'])),
  ]);
  await settle();
  const during = await memory.read();
  expect(during?.tables.Card?.map(({ id }) => id).toSorted()).toEqual(['both', 'k']);
  // The group loads, and the records of its pages are saved then.
  pool.applyGroups(['space:x', 'space:y'], []);
  await settle();
  const after = await memory.read();
  expect(after?.tables.Card?.map(({ id }) => id).toSorted()).toEqual(['both', 'k', 'r1']);
});

test('an older copy of a first load that was cut off loses each record that the pull from 0 does not send', async () => {
  // A build before this one saved the page of a first load that did not finish.
  const memory = memoryLocalDatabase({
    lastSyncId: 0,
    groups: [],
    tables: { Card: [{ id: 'r1', title: 'r1', space: 'x' }] },
    meta: { 'Card\u0000r1': { groups: ['space:x'], syncId: 1 } },
    pending: [],
  });
  const pool = await loadPool(memory, [], [cards]);
  pool.applyGroups(['space:x'], [delta(2, put('r2', ['space:x']))]);
  pool.applyDeltas([delta(3)]);
  await settle();
  const saved = await memory.read();
  expect(saved?.tables.Card?.map(({ id }) => id)).toEqual(['r2']);
});

test('an older copy with a record of a group that never loaded loses it at the first Groups message', () => {
  const pool = createPool([], declared);
  pool.load({
    lastSyncId: 5,
    groups: ['space:y'],
    tables: { Card: [{ id: 'r1', title: 'r1', space: 'x' }] },
    meta: { 'Card\u0000r1': { groups: ['space:x'], syncId: 1 } },
    pending: [],
  });
  pool.applyGroups(['space:y'], []);
  expect(pool.ids(card)).toEqual([]);
});

test('at sync ID 0, the Groups message that ends the snapshot drops each record that it did not send', () => {
  const pool = createPool([], declared);
  const leave = pool.onLoadRequest(() => {
    // The engine listens for the length of one pull.
  });
  pool.applyGroups(
    ['space:x'],
    [delta(1, put('r1', ['space:x'])), delta(2, put('r2', ['space:x']))],
  );
  // The pull ends before the delta at the head. The next pull from 0 sends the snapshot again.
  leave();
  pool.applyPage('space:x', [delta(2, put('r2', ['space:x']))]);
  pool.applyGroups(['space:x'], []);
  expect(pool.ids(card)).toEqual(['r2']);
});

function sessionStays() {
  // No test ends the session.
}

/**
 * Runs the engine over handlers in memory. The first pull from 0 sends the
 * snapshot of `space:y`, with its record k, and the delta at the head. Then
 * it sends one page of `space:x` with `firstPage`, and the socket drops. The
 * next pull sends the snapshot of `space:x` as it is now, `nowInX`. It
 * returns when the gate of `space:x` resolves.
 */
async function cutOffLoad(pool: Pool, firstPage: ReadonlyArray<Change>, nowInX: Array<Change>) {
  const gate = pool.loadGroup('space:x');
  let pulls = 0;
  const loads = Effect.runSync(Queue.unbounded<string>());
  const handlers = SyncRpcs.toLayer({
    Push: () => Effect.succeed([]),
    Pull: () => {
      pulls += 1;
      const first = pulls === 1;
      const opened = Stream.make<Array<SyncMessage>>(
        {
          _tag: 'Groups',
          loaded: ['space:y'],
          backfill: first ? [delta(1, put('k', ['space:y']))] : [],
        },
        { _tag: 'Deltas', deltas: first ? [delta(1)] : [] },
      );
      const afterLoad = Stream.unwrap(
        Effect.map(Queue.take(loads), (): Stream.Stream<SyncMessage> =>
          first
            ? Stream.concat(
                Stream.make<Array<SyncMessage>>({
                  _tag: 'Page',
                  group: 'space:x',
                  backfill: [delta(1, ...firstPage)],
                }),
                Stream.die('The socket dropped.'),
              )
            : Stream.concat(
                Stream.make<Array<SyncMessage>>({
                  _tag: 'Groups',
                  loaded: ['space:x', 'space:y'],
                  backfill: [delta(1, ...nowInX)],
                }),
                Stream.never,
              ),
        ),
      );
      return Stream.concat(opened, afterLoad);
    },
    Load: ({ group }) => Queue.offer(loads, group).pipe(Effect.asVoid),
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
}

test('case B: a socket that drops between two pages leaves no record that the server deleted', async () => {
  const pool = createPool([], declared, { stamps: testStamps() });
  await cutOffLoad(
    pool,
    [put('r1', ['space:x']), put('r2', ['space:x'])],
    [put('r2', ['space:x'])],
  );
  expect(pool.ids(card).toSorted()).toEqual(['k', 'r2']);
});

test('a record of a loaded group survives a cut-off load of another group', async () => {
  const pool = createPool([], declared, { stamps: testStamps() });
  await cutOffLoad(pool, [put('both', ['space:x', 'space:y'])], []);
  expect(pool.ids(card).toSorted()).toEqual(['both', 'k']);
});
