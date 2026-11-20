import { expect, test } from 'bun:test';
import { readdirSync } from 'node:fs';

import { defineContract } from '@repo/sync/contract/define';
import { organizationGroup } from '@repo/sync/contract/engine-groups';
import { record } from '@repo/sync/contract/record';
import { fillRecords } from '@repo/sync/repo/events';
import * as schema from '@repo/sync/repo/schema';
import { syncCounters, syncEvents, syncRecords } from '@repo/sync/repo/schema';
import { trimLog } from '@repo/sync/repo/trim';
import { DatabasePostgres } from '@repo/sync/runtime/database.server';
import { migrateSync } from '@repo/sync/runtime/migrate.server';
import { Database } from '@repo/sync/service/database';
import { EventLog, eventLog } from '@repo/sync/service/event-log';
import { describeOnPostgres, freshDatabase, rowsOf } from '@repo/sync/testing/postgres';
import type { Change } from '@repo/sync/types/protocol';
import { asc, getTableName, is, sql } from 'drizzle-orm';
import { PgTable } from 'drizzle-orm/pg-core';
import { Context, Effect, Layer, Schema } from 'effect';

/**
 * The SQL of the log that only PGlite ran before: the migrations, the fill of
 * `sync_records` from an older log, and the trim. Each test gets a new
 * database on the real server.
 */

const cardRecord = record('Card', {
  fields: { id: 'string', title: 'string' },
  groups: [organizationGroup.ofScope],
});
const cards = defineContract('cards', { records: [cardRecord], commands: [], loads: [] });

const upsert = (id: string, groups: ReadonlyArray<string> = ['org:a']): Change => ({
  model: 'Card',
  id,
  action: 'upsert',
  data: { id, title: id },
  groups,
});
const remove = (id: string): Change => ({ ...upsert(id), action: 'delete', data: null });

const day = 24 * 60 * 60 * 1000;

/** Runs `program` with one process over a new, unmigrated database. */
function onServer<A, E>(serverUrl: string, program: Effect.Effect<A, E, Database | EventLog>) {
  return Effect.runPromise(
    Effect.gen(function* () {
      const urlOf = yield* freshDatabase(serverUrl);
      const process = eventLog([cards]).pipe(Layer.provideMerge(DatabasePostgres(urlOf('repo'))));
      return yield* program.pipe(Effect.provideContext(yield* Layer.build(process)));
    }).pipe(Effect.scoped),
  );
}

/** Commits each change of `organizationId` in its own event, then gives each event the age in days of `ages`. */
const writeAged = (
  organizationId: string,
  changes: ReadonlyArray<Change>,
  ages: ReadonlyArray<number>,
) =>
  Effect.gen(function* () {
    const log = yield* EventLog;
    const db = yield* Database;
    for (const [index, change] of changes.entries()) {
      yield* log.commit(organizationId, `${organizationId}-t${index + 1}`, () =>
        Effect.succeed([change]),
      );
    }
    for (const [index, age] of ages.entries()) {
      yield* db.execute(
        sql`update ${syncEvents} set created_at = now() - make_interval(days => ${age})
          where organization_id = ${organizationId} and sync_id = ${index + 1}`,
      );
    }
  });

/** The sync IDs and the record IDs that the database holds for `organizationId`. */
const kept = (organizationId: string) =>
  Effect.gen(function* () {
    const db = yield* Database;
    const events = yield* db
      .select({ syncId: syncEvents.syncId })
      .from(syncEvents)
      .where(sql`${syncEvents.organizationId} = ${organizationId}`)
      .orderBy(asc(syncEvents.syncId));
    const records = yield* db
      .select({ id: syncRecords.recordId })
      .from(syncRecords)
      .where(sql`${syncRecords.organizationId} = ${organizationId}`)
      .orderBy(asc(syncRecords.recordId));
    return { events: events.map((row) => row.syncId), records: records.map((row) => row.id) };
  });

/** The tables that the schema of the log declares, by name. */
const declaredTables = Object.values(schema)
  .filter((value) => is(value, PgTable))
  .map((table) => getTableName(table))
  .toSorted();

/** How many migrations the sync engine has: one folder each. */
const migrationCount = readdirSync(new URL('migrations', import.meta.url)).length;

/** How many migrations of the sync engine the database records as applied. */
const appliedSync = (db: Context.Service.Shape<typeof Database>) =>
  rowsOf(
    db,
    Schema.Struct({ count: Schema.Number }),
    sql`select count(*)::int as count from drizzle.__migrations_sync`,
  ).pipe(Effect.map((rows) => rows[0]?.count));

describeOnPostgres('the SQL of the log on a real Postgres server', (serverUrl) => {
  test('the migrations of the sync engine run on the server, and a second run changes nothing', async () => {
    const result = await onServer(
      serverUrl,
      Effect.gen(function* () {
        const db = yield* Database;
        yield* migrateSync(db);
        yield* migrateSync(db);
        const tables = yield* rowsOf(
          db,
          Schema.Struct({ name: Schema.String }),
          sql`select table_name::text as name from information_schema.tables
            where table_schema = 'public' and table_name like 'sync_%' order by table_name`,
        );
        return { tables: tables.map((row) => row.name), applied: yield* appliedSync(db) };
      }),
    );
    expect(result.tables).toEqual(declaredTables);
    expect(result.applied).toBe(migrationCount);
  }, 20_000);

  test('four processes that start at once each migrate the new database, and each migration applies once', async () => {
    const result = await Effect.runPromise(
      Effect.gen(function* () {
        const urlOf = yield* freshDatabase(serverUrl);
        const processes = yield* Effect.forEach(['a', 'b', 'c', 'd'], (name) =>
          Effect.map(Layer.build(DatabasePostgres(urlOf(name))), (built) =>
            Context.get(built, Database),
          ),
        );
        yield* Effect.forEach(processes, migrateSync, { concurrency: 'unbounded' });
        const [first] = processes;
        return first ? yield* appliedSync(first) : 0;
      }).pipe(Effect.scoped),
    );
    expect(result).toBe(migrationCount);
  }, 20_000);

  test('the fill builds sync_records from a log that has events and no rows, once', async () => {
    const result = await onServer(
      serverUrl,
      Effect.gen(function* () {
        const db = yield* Database;
        yield* migrateSync(db);
        // Events that an older server wrote: it kept no record state.
        yield* db.insert(syncEvents).values([
          {
            organizationId: 'org-a',
            syncId: 1,
            transactionId: 't1',
            changes: [upsert('a', ['space:x']), upsert('b', ['space:x'])],
            groups: ['space:x'],
          },
          {
            organizationId: 'org-a',
            syncId: 2,
            transactionId: 't2',
            // Two changes of one record in one event: the last one wins.
            changes: [upsert('a', ['space:x']), upsert('a', ['space:y'])],
            groups: ['space:x', 'space:y'],
          },
          {
            organizationId: 'org-a',
            syncId: 3,
            transactionId: 't3',
            changes: [{ ...remove('b'), groups: ['space:x'] }],
            groups: ['space:x'],
          },
          {
            organizationId: 'org-b',
            syncId: 1,
            transactionId: 't4',
            changes: [upsert('a', ['org:b'])],
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
        yield* fillRecords(db);
        const again = yield* db.select().from(syncRecords);
        return { filled, again: again.length };
      }),
    );
    expect(result.filled).toEqual([
      {
        organizationId: 'org-a',
        model: 'Card',
        recordId: 'a',
        groups: ['space:y'],
        syncId: 2,
        data: { id: 'a', title: 'a' },
        deleted: false,
      },
      {
        organizationId: 'org-a',
        model: 'Card',
        recordId: 'b',
        groups: ['space:x'],
        syncId: 3,
        data: null,
        deleted: true,
      },
      {
        organizationId: 'org-b',
        model: 'Card',
        recordId: 'a',
        groups: ['org:b'],
        syncId: 1,
        data: { id: 'a', title: 'a' },
        deleted: false,
      },
    ]);
    expect(result.again).toBe(3);
  }, 20_000);

  test('the trim deletes each event up to the newest one before the cut, and each deleted record older than the log, and no more', async () => {
    const result = await onServer(
      serverUrl,
      Effect.gen(function* () {
        yield* migrateSync(yield* Database);
        // Event 4 started its transaction after event 5, so its time is newer.
        yield* writeAged(
          'org-a',
          [upsert('a'), remove('a'), upsert('b'), upsert('c'), upsert('d'), remove('b')],
          [30, 30, 20, 9, 12, 1],
        );
        // Every event of org-b is older than the cut.
        yield* writeAged('org-b', [upsert('x'), upsert('y')], [40, 40]);
        yield* trimLog(yield* Database, new Date(Date.now() - 10 * day));
        const log = yield* EventLog;
        return {
          a: yield* kept('org-a'),
          b: yield* kept('org-b'),
          oldest: [yield* log.oldest('org-a'), yield* log.oldest('org-b')],
          heads: [yield* log.head('org-a'), yield* log.head('org-b')],
        };
      }),
    );
    // Event 4 goes too, so the log keeps one run of sync IDs with no gap.
    // Record a was deleted at 2, before the log now starts. Record b was deleted at 6, which stays.
    expect(result.a).toEqual({ events: [6], records: ['b', 'c', 'd'] });
    // The newest event of an organization always stays, so its head stays right.
    expect(result.b).toEqual({ events: [2], records: ['x', 'y'] });
    expect(result.oldest).toEqual([6, 2]);
    expect(result.heads).toEqual([6, 2]);
  }, 20_000);
});
