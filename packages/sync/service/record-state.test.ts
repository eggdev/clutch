import { expect, test } from 'bun:test';

import { defineContract } from '@repo/sync/contract/define';
import { organizationGroup } from '@repo/sync/contract/engine-groups';
import { record } from '@repo/sync/contract/record';
import { fillRecords } from '@repo/sync/repo/events';
import { syncCounters, syncEvents, syncRecords } from '@repo/sync/repo/schema';
import { Database } from '@repo/sync/service/database';
import { EventLog, eventLog } from '@repo/sync/service/event-log';
import { DatabaseTest } from '@repo/sync/testing/database';
import type { Change } from '@repo/sync/types/protocol';
import { sql } from 'drizzle-orm';
import { Effect, Layer } from 'effect';
import type { Context } from 'effect';

/**
 * The last state of each record in `sync_records`, and the groups that a
 * change names as left. The log keeps it in the transaction of each event.
 */

/** A card of the organization, so each change of `Card` fits a declared record. */
const cardRecord = record('Card', {
  fields: { id: 'string', title: 'string' },
  groups: [organizationGroup.ofScope],
});
const cards = defineContract('cards', { records: [cardRecord], commands: [], loads: [] });

const change = (id: string, groups: ReadonlyArray<string>): Change => ({
  model: 'Card',
  id,
  action: 'upsert',
  data: { id, title: id },
  groups,
});

/** The stored state of each record, sorted by ID, without the organization. */
const recordRows = (db: Context.Service.Shape<typeof Database>) =>
  db
    .select()
    .from(syncRecords)
    .pipe(
      Effect.map((rows) =>
        rows
          .toSorted((a, b) => a.recordId.localeCompare(b.recordId))
          .map(({ recordId, groups, syncId, data, deleted }) => ({
            recordId,
            groups: groups.toSorted(),
            syncId,
            data,
            deleted,
          })),
      ),
    );

/** Runs a program with the log and the database itself. */
function withDatabase<A, E>(program: Effect.Effect<A, E, EventLog | Database>) {
  return Effect.runPromise(
    program.pipe(Effect.provide(Layer.provideMerge(eventLog([cards]), DatabaseTest()))),
  );
}

test('a change that moves a record names the groups it left, and its event is indexed under them', async () => {
  const result = await withDatabase(
    Effect.gen(function* () {
      const log = yield* EventLog;
      const db = yield* Database;
      yield* log.commit('org-a', 't1', () => Effect.succeed([change('a', ['space:x', 'org:a'])]));
      yield* log.commit('org-a', 't2', () => Effect.succeed([change('a', ['space:y', 'org:a'])]));
      const events = yield* db
        .select({ changes: syncEvents.changes, groups: syncEvents.groups })
        .from(syncEvents)
        .orderBy(syncEvents.syncId);
      return { events, records: yield* recordRows(db) };
    }),
  );
  expect(result.events[0]?.changes[0]?.left).toBeUndefined();
  expect(result.events[1]?.changes[0]?.left).toEqual(['space:x']);
  expect(result.events[1]?.groups.toSorted()).toEqual(['org:a', 'space:x', 'space:y']);
  expect(result.records).toEqual([
    {
      recordId: 'a',
      groups: ['org:a', 'space:y'],
      syncId: 2,
      data: { id: 'a', title: 'a' },
      deleted: false,
    },
  ]);
});

test('the record state follows each change of one event, and a delete marks it', async () => {
  const result = await withDatabase(
    Effect.gen(function* () {
      const log = yield* EventLog;
      const db = yield* Database;
      // Two changes of one record in one event: the second leaves the groups of the first.
      yield* log.commit('org-a', 't1', () =>
        Effect.succeed([
          change('a', ['space:x']),
          change('a', ['space:y']),
          change('b', ['space:x']),
        ]),
      );
      yield* log.commit('org-a', 't2', () =>
        Effect.succeed([{ ...change('b', ['space:x']), action: 'delete' as const }]),
      );
      const records = yield* recordRows(db);
      // A record that comes back after a delete left no group: its clients deleted it already.
      yield* log.commit('org-a', 't3', () => Effect.succeed([change('b', ['space:z'])]));
      const [back] = yield* db
        .select({ changes: syncEvents.changes })
        .from(syncEvents)
        .where(sql`${syncEvents.syncId} = 3`);
      const [first] = yield* db
        .select({ changes: syncEvents.changes })
        .from(syncEvents)
        .where(sql`${syncEvents.syncId} = 1`);
      return {
        records,
        back: back?.changes[0]?.left,
        first: first?.changes.map((item) => item.left),
      };
    }),
  );
  expect(result.first).toEqual([undefined, ['space:x'], undefined]);
  expect(result.records).toEqual([
    {
      recordId: 'a',
      groups: ['space:y'],
      syncId: 1,
      data: { id: 'a', title: 'a' },
      deleted: false,
    },
    { recordId: 'b', groups: ['space:x'], syncId: 2, data: { id: 'b', title: 'b' }, deleted: true },
  ]);
  expect(result.back).toBeUndefined();
});

test('a log with events and no record state gets the state of each record from its events', async () => {
  const result = await withDatabase(
    Effect.gen(function* () {
      const log = yield* EventLog;
      const db = yield* Database;
      // Events that an older server wrote: it kept no record state.
      yield* db.insert(syncEvents).values([
        {
          organizationId: 'org-a',
          syncId: 1,
          transactionId: 't1',
          changes: [change('a', ['space:x']), change('b', ['space:x'])],
          groups: ['space:x'],
        },
        {
          organizationId: 'org-a',
          syncId: 2,
          transactionId: 't2',
          changes: [change('a', ['space:y'])],
          groups: ['space:y'],
        },
        {
          organizationId: 'org-a',
          syncId: 3,
          transactionId: 't3',
          changes: [{ ...change('b', ['space:x']), action: 'delete', data: null }],
          groups: ['space:x'],
        },
        {
          organizationId: 'org-b',
          syncId: 1,
          transactionId: 't4',
          changes: [change('a', ['org:b'])],
          groups: ['org:b'],
        },
      ]);
      yield* db.insert(syncCounters).values([
        { organizationId: 'org-a', nextSyncId: 4 },
        { organizationId: 'org-b', nextSyncId: 2 },
      ]);
      yield* fillRecords(db);
      const filled = yield* db
        .select()
        .from(syncRecords)
        .orderBy(syncRecords.organizationId, syncRecords.recordId);
      // A second run changes nothing, and the next move names the group that it left.
      yield* fillRecords(db);
      const again = yield* db.select().from(syncRecords);
      yield* log.commit('org-a', 't5', () => Effect.succeed([change('a', ['space:z'])]));
      const [moved] = yield* db
        .select({ changes: syncEvents.changes })
        .from(syncEvents)
        .where(sql`${syncEvents.organizationId} = 'org-a' and ${syncEvents.syncId} = 4`);
      return { filled, again: again.length, left: moved?.changes[0]?.left };
    }),
  );
  expect(
    result.filled.map(({ organizationId, recordId, groups, syncId, data, deleted }) => ({
      organizationId,
      recordId,
      groups,
      syncId,
      data,
      deleted,
    })),
  ).toEqual([
    {
      organizationId: 'org-a',
      recordId: 'a',
      groups: ['space:y'],
      syncId: 2,
      data: { id: 'a', title: 'a' },
      deleted: false,
    },
    {
      organizationId: 'org-a',
      recordId: 'b',
      groups: ['space:x'],
      syncId: 3,
      data: null,
      deleted: true,
    },
    {
      organizationId: 'org-b',
      recordId: 'a',
      groups: ['org:b'],
      syncId: 1,
      data: { id: 'a', title: 'a' },
      deleted: false,
    },
  ]);
  expect(result.again).toBe(3);
  expect(result.left).toEqual(['space:y']);
});
