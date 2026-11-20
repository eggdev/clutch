import { expect, test } from 'bun:test';

import { defineContract } from '@repo/sync/contract/define';
import { defineGroup } from '@repo/sync/contract/groups';
import { record } from '@repo/sync/contract/record';
import { createPool } from '@repo/sync/runtime/pool';
import { EventLog, eventLog } from '@repo/sync/service/event-log';
import { feed } from '@repo/sync/service/feed';
import type { LoadRequest } from '@repo/sync/service/feed';
import { DatabaseTest } from '@repo/sync/testing/database';
import { Change, SyncMessage } from '@repo/sync/types/protocol';
import { Effect, Layer, Queue, Schema, Stream } from 'effect';

/** A card of one space. A change of its space moves it to the group of the other space. */
const card = record('Card', {
  fields: { id: 'string', title: 'string', space: 'string' },
  groups: [defineGroup('space').by('space')],
});
const cards = defineContract('cards', { records: [card], commands: [], loads: [] });

const put = (space: string): Change => ({
  model: 'Card',
  id: 'a',
  action: 'upsert',
  data: { id: 'a', title: 'A', space },
  groups: [`space:${space}`],
});

/** The messages that a client of `loaded` reads from the start of the log, through the wire form. */
function messagesFor(loaded: ReadonlyArray<string>) {
  return Effect.gen(function* () {
    const log = yield* EventLog;
    yield* log.commit('org-a', 't1', () => Effect.succeed([put('x')]));
    yield* log.commit('org-a', 't2', () => Effect.succeed([put('y')]));
    const messages = yield* feed(log, {
      organizationId: 'org-a',
      userId: 'u',
      lastSyncId: 0,
      loaded,
      granted: Effect.succeed({ eager: [], lazy: ['space:x', 'space:y'] }),
      requests: yield* Queue.unbounded<LoadRequest>(),
    }).pipe(Stream.take(2), Stream.runCollect, Effect.timeout('2 seconds'));
    const wire = Schema.toCodecJson(SyncMessage);
    return messages.map((message) =>
      Schema.decodeUnknownSync(wire)(structuredClone(Schema.encodeSync(wire)(message))),
    );
  }).pipe(Effect.provide(eventLog([cards]).pipe(Layer.provide(DatabaseTest()))));
}

/** A pool that applies each message, as the engine does. */
function apply(messages: ReadonlyArray<SyncMessage>) {
  const pool = createPool([], { records: [card], commands: [] });
  for (const message of messages) {
    if (message._tag === 'Deltas') {
      pool.applyDeltas(message.deltas);
    } else if (message._tag === 'Groups') {
      pool.applyGroups(message.loaded, message.backfill);
    }
  }
  return pool;
}

test('after a move, a client of the old group drops the record and one of the new group holds it', async () => {
  const old = apply(await Effect.runPromise(messagesFor(['space:x'])));
  expect(old.get(card, 'a')).toBeUndefined();
  expect(old.lastSyncId()).toBe(2);
  const next = apply(await Effect.runPromise(messagesFor(['space:y'])));
  expect(next.get(card, 'a')).toEqual({ id: 'a', title: 'A', space: 'y' });
});

test('a change with no `left` key still applies, and an older build reads a change with it', () => {
  const older = Schema.Struct({
    model: Schema.String,
    id: Schema.String,
    action: Schema.Literals(['upsert', 'delete']),
    data: Schema.NullOr(Schema.Record(Schema.String, Schema.Unknown)),
    groups: Schema.Array(Schema.String),
  });
  const moved = { ...put('y'), left: ['space:x'] };
  expect(Schema.decodeUnknownSync(older)(moved)).toEqual(put('y'));
  const decoded = Schema.decodeUnknownSync(Change)(put('x'));
  const pool = createPool([], { records: [card], commands: [] });
  pool.applyGroups(['space:x'], []);
  pool.applyDeltas([{ syncId: 1, transactionId: null, changes: [decoded] }]);
  expect(pool.get(card, 'a')).toEqual({ id: 'a', title: 'A', space: 'x' });
});
