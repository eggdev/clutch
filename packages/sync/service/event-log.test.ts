import { expect, test } from 'bun:test';

import { syncEvents } from '@repo/sync/repo/schema';
import { Database } from '@repo/sync/service/database';
import { EventLog, EventLogLive } from '@repo/sync/service/event-log';
import { DatabaseTest } from '@repo/sync/testing/database';
import type { Change } from '@repo/sync/types/protocol';
import { sql } from 'drizzle-orm';
import { Effect, Layer } from 'effect';

const change = (id: string, groups: ReadonlyArray<string> = ['org:a']): Change => ({
  model: 'Card',
  id,
  action: 'upsert',
  data: { title: id },
  groups,
});

function run<A, E>(program: Effect.Effect<A, E, EventLog>) {
  return Effect.runPromise(
    program.pipe(Effect.provide(EventLogLive.pipe(Layer.provide(DatabaseTest())))),
  );
}

test('each organization gets sync IDs that only increase', async () => {
  const ids = await run(
    Effect.gen(function* () {
      const log = yield* EventLog;
      const first = yield* log.commit('org-a', 't1', () => Effect.succeed([change('a')]));
      const second = yield* log.commit('org-a', 't2', () => Effect.succeed([change('b')]));
      const other = yield* log.commit('org-b', 't3', () => Effect.succeed([change('c')]));
      return [first, second, other];
    }),
  );
  expect(ids).toEqual([1, 2, 1]);
});

test('a resent transaction applies once and returns its first sync ID', async () => {
  let writes = 0;
  const write = () =>
    Effect.sync(() => {
      writes += 1;
      return [change('a')];
    });
  const ids = await run(
    Effect.gen(function* () {
      const log = yield* EventLog;
      return [yield* log.commit('org-a', 't1', write), yield* log.commit('org-a', 't1', write)];
    }),
  );
  expect(ids).toEqual([1, 1]);
  expect(writes).toBe(1);
});

test('a failed write leaves no event, and the next write gets the next ID', async () => {
  const ids = await run(
    Effect.gen(function* () {
      const log = yield* EventLog;
      const failed = yield* log
        .commit('org-a', 't1', () => Effect.fail('refused'))
        .pipe(Effect.flip);
      const next = yield* log.commit('org-a', 't2', () => Effect.succeed([change('a')]));
      return [failed, next];
    }),
  );
  expect(ids).toEqual(['refused', 1]);
});

test('the head is the newest sync ID of an organization, or 0', async () => {
  const heads = await run(
    Effect.gen(function* () {
      const log = yield* EventLog;
      const empty = yield* log.head('org-a');
      yield* log.commit('org-a', 't1', () => Effect.succeed([change('a')]));
      yield* log.commit('org-a', 't2', () => Effect.succeed([change('b')]));
      return [empty, yield* log.head('org-a'), yield* log.head('org-b')];
    }),
  );
  expect(heads).toEqual([0, 2, 0]);
});

test('an event stores the groups of its changes, and a GIN index covers them', async () => {
  const result = await Effect.runPromise(
    Effect.gen(function* () {
      const log = yield* EventLog;
      const db = yield* Database;
      yield* log.commit('org-a', 't1', () =>
        Effect.succeed([change('a', ['space:x']), change('b', ['space:x', 'user:u'])]),
      );
      const events = yield* db.select({ groups: syncEvents.groups }).from(syncEvents);
      const indexes = yield* db.execute(
        sql`select indexdef from pg_indexes where indexname = 'sync_events_groups'`,
      );
      return { events, indexes: JSON.stringify(indexes) };
    }).pipe(Effect.provide(Layer.provideMerge(EventLogLive, DatabaseTest()))),
  );
  expect(result.events[0]?.groups.toSorted()).toEqual(['space:x', 'user:u']);
  expect(result.indexes).toContain('USING gin');
});

test('a change with no groups fails the commit, so no event reaches no one', async () => {
  const exit = await run(
    Effect.gen(function* () {
      const log = yield* EventLog;
      return yield* log
        .commit('org-a', 't1', () => Effect.succeed([change('a', [])]))
        .pipe(Effect.exit);
    }),
  );
  expect(exit._tag).toBe('Failure');
});
