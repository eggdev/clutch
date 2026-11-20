import { expect, test } from 'bun:test';

import { defineContract } from '@repo/sync/contract/define';
import { organizationGroup } from '@repo/sync/contract/engine-groups';
import { record } from '@repo/sync/contract/record';
import { trimLogJob } from '@repo/sync/jobs/trim-log';
import { syncEvents, syncRecords } from '@repo/sync/repo/schema';
import { oldestOf, trimLog } from '@repo/sync/repo/trim';
import { Database } from '@repo/sync/service/database';
import { EventLog, eventLog } from '@repo/sync/service/event-log';
import { DatabaseTest } from '@repo/sync/testing/database';
import type { Change } from '@repo/sync/types/protocol';
import { asc, sql } from 'drizzle-orm';
import { ConfigProvider, Effect, Layer } from 'effect';

const cardRecord = record('Card', {
  fields: { id: 'string', title: 'string' },
  groups: [organizationGroup.ofScope],
});
const cards = defineContract('cards', { records: [cardRecord], commands: [], loads: [] });

const upsert = (id: string): Change => ({
  model: 'Card',
  id,
  action: 'upsert',
  data: { id, title: id },
  groups: ['org:a'],
});
const remove = (id: string): Change => ({ ...upsert(id), action: 'delete' });

const day = 24 * 60 * 60 * 1000;

/** The context of one run of the trim job. It commits nothing. */
const jobContext = {
  jobId: 'sync/trim-log:1',
  organizationId: null,
  attempt: 1,
  commit: () => Effect.die('The trim job commits nothing.'),
};

function run<A, E>(
  program: Effect.Effect<A, E, EventLog | Database>,
  env: Record<string, string> = {},
) {
  return Effect.runPromise(
    program.pipe(
      Effect.provide(Layer.provideMerge(eventLog([cards]), DatabaseTest())),
      Effect.provide(ConfigProvider.layer(ConfigProvider.fromEnv({ env }))),
    ),
  );
}

/** Writes the events of `org-a`, each with the age in days that `ages` gives, oldest sync ID first. */
const writeAged = (changes: ReadonlyArray<Change>, ages: ReadonlyArray<number>) =>
  Effect.gen(function* () {
    const log = yield* EventLog;
    const db = yield* Database;
    for (const [index, change] of changes.entries()) {
      yield* log.commit('org-a', `t${index + 1}`, () => Effect.succeed([change]));
    }
    for (const [index, age] of ages.entries()) {
      yield* db.execute(
        sql`update ${syncEvents} set created_at = now() - make_interval(days => ${age})
          where sync_id = ${index + 1}`,
      );
    }
  });

/** The sync IDs that the log holds, and the records that the record table holds. */
const kept = Effect.gen(function* () {
  const db = yield* Database;
  const events = yield* db
    .select({ syncId: syncEvents.syncId })
    .from(syncEvents)
    .orderBy(asc(syncEvents.syncId));
  const records = yield* db
    .select({ id: syncRecords.recordId })
    .from(syncRecords)
    .orderBy(asc(syncRecords.recordId));
  return { events: events.map((row) => row.syncId), records: records.map((row) => row.id) };
});

test('a trim deletes one run of events from the first, up to the newest one before the cut', async () => {
  const result = await run(
    Effect.gen(function* () {
      // Event 3 started its transaction before event 2, so its time is older.
      yield* writeAged([upsert('a'), upsert('b'), upsert('c'), upsert('d')], [20, 9, 12, 1]);
      const db = yield* Database;
      yield* trimLog(db, new Date(Date.now() - 10 * day));
      return { ...(yield* kept), oldest: yield* oldestOf(db, 'org-a') };
    }),
  );
  // A cut by time alone would keep 2 and drop 3, and a client at 2 would miss 3.
  expect(result.events).toEqual([4]);
  expect(result.oldest).toBe(4);
});

test('a trim keeps the newest event of an organization, so its head stays right', async () => {
  const result = await run(
    Effect.gen(function* () {
      yield* writeAged([upsert('a'), upsert('b')], [30, 30]);
      const db = yield* Database;
      yield* trimLog(db, new Date(Date.now() - day));
      return { ...(yield* kept), head: yield* (yield* EventLog).head('org-a') };
    }),
  );
  expect(result.events).toEqual([2]);
  expect(result.head).toBe(2);
});

test('a trim deletes a deleted record only when its delete is older than the log', async () => {
  const result = await run(
    Effect.gen(function* () {
      // a is deleted at 2, which the trim drops. b is deleted at 4, which stays.
      yield* writeAged(
        [upsert('a'), remove('a'), upsert('b'), remove('b'), upsert('c')],
        [30, 30, 30, 1, 1],
      );
      const db = yield* Database;
      yield* trimLog(db, new Date(Date.now() - 10 * day));
      return yield* kept;
    }),
  );
  expect(result.events).toEqual([4, 5]);
  expect(result.records).toEqual(['b', 'c']);
});

test('the trim job deletes nothing when SYNC_LOG_KEEP_DAYS is not set', async () => {
  const result = await run(
    Effect.gen(function* () {
      yield* writeAged([upsert('a'), upsert('b')], [400, 300]);
      yield* trimLogJob.execute({}, jobContext);
      return yield* kept;
    }),
  );
  expect(result.events).toEqual([1, 2]);
});

test('the trim job keeps the days that SYNC_LOG_KEEP_DAYS names', async () => {
  const result = await run(
    Effect.gen(function* () {
      yield* writeAged([upsert('a'), upsert('b'), upsert('c')], [40, 20, 1]);
      yield* trimLogJob.execute({}, jobContext);
      return yield* kept;
    }),
    { SYNC_LOG_KEEP_DAYS: '30' },
  );
  expect(result.events).toEqual([2, 3]);
});
