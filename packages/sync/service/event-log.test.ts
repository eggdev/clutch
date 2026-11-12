import { expect, test } from 'bun:test';

import { defineContract } from '@repo/sync/contract/define';
import { organizationGroup } from '@repo/sync/contract/engine-groups';
import { record } from '@repo/sync/contract/record';
import { syncEvents } from '@repo/sync/repo/schema';
import { Database } from '@repo/sync/service/database';
import { EventLog, eventLog } from '@repo/sync/service/event-log';
import { DatabaseTest } from '@repo/sync/testing/database';
import type { Change } from '@repo/sync/types/protocol';
import { sql } from 'drizzle-orm';
import { Cause, Effect, Exit, Layer, PubSub } from 'effect';

/** A card of the organization, so each change of `Card` fits a declared record. */
const cardRecord = record('Card', {
  fields: { id: 'string', title: 'string' },
  groups: [organizationGroup.ofScope],
});
const cards = defineContract('cards', { records: [cardRecord], commands: [], loads: [] });

const change = (id: string, groups: ReadonlyArray<string> = ['org:a']): Change => ({
  model: 'Card',
  id,
  action: 'upsert',
  data: { id, title: id },
  groups,
});

function run<A, E>(program: Effect.Effect<A, E, EventLog>) {
  return Effect.runPromise(
    program.pipe(Effect.provide(eventLog([cards]).pipe(Layer.provide(DatabaseTest())))),
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
    }).pipe(Effect.provide(Layer.provideMerge(eventLog([cards]), DatabaseTest()))),
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

test('a commit of a record that fits reaches a subscriber', async () => {
  const delta = await run(
    Effect.scoped(
      Effect.gen(function* () {
        const log = yield* EventLog;
        const subscription = yield* log.subscribe('org-a');
        yield* log.commit('org-a', 't1', () => Effect.succeed([change('a')]));
        return yield* PubSub.take(subscription);
      }),
    ),
  );
  expect(delta).toEqual({ syncId: 1, transactionId: 't1', changes: [change('a')] });
});

test('a hand-built upsert with a field of the wrong kind fails, and appends nothing', async () => {
  const result = await run(
    Effect.gen(function* () {
      const log = yield* EventLog;
      const exit = yield* log
        .commit('org-a', 't1', () =>
          Effect.succeed([{ ...change('a'), data: { id: 'a', title: 7 } }]),
        )
        .pipe(Effect.exit);
      return { exit, head: yield* log.head('org-a') };
    }),
  );
  expect(Exit.isFailure(result.exit)).toBe(true);
  const message = Exit.isFailure(result.exit) ? Cause.pretty(result.exit.cause) : '';
  expect(message).toContain('upsert of Card a');
  expect(message).toContain('title');
  expect(result.head).toBe(0);
});

test('a change that carries a field that its record does not declare fails, and appends nothing', async () => {
  const result = await run(
    Effect.gen(function* () {
      const log = yield* EventLog;
      // A spread of a table row would carry such a column to each client of the group.
      const leaked = { id: 'a', title: 'a', passwordHash: 'secret' };
      const upsert = yield* log
        .commit('org-a', 't1', () => Effect.succeed([{ ...change('a'), data: leaked }]))
        .pipe(Effect.exit);
      const removal = yield* log
        .commit('org-a', 't2', () =>
          Effect.succeed([{ ...change('a'), action: 'delete' as const, data: leaked }]),
        )
        .pipe(Effect.exit);
      return { exits: [upsert, removal], head: yield* log.head('org-a') };
    }),
  );
  for (const exit of result.exits) {
    expect(Exit.isFailure(exit) ? Cause.pretty(exit.cause) : '').toContain(
      'The change of Card a carries passwordHash, which its record does not declare.',
    );
  }
  expect(result.head).toBe(0);
});

test('a commit of a model that no contract declares fails, and appends nothing', async () => {
  const result = await run(
    Effect.gen(function* () {
      const log = yield* EventLog;
      const exit = yield* log
        .commit('org-a', 't1', () =>
          Effect.succeed([{ ...change('n1'), model: 'Note', data: { id: 'n1', text: 'Hi' } }]),
        )
        .pipe(Effect.exit);
      return { exit, head: yield* log.head('org-a') };
    }),
  );
  expect(Exit.isFailure(result.exit)).toBe(true);
  const message = Exit.isFailure(result.exit) ? Cause.pretty(result.exit.cause) : '';
  expect(message).toContain('Note n1');
  expect(message).toContain('no contract declares');
  expect(result.head).toBe(0);
});

test('a delete of a declared model commits', async () => {
  const ids = await run(
    Effect.gen(function* () {
      const log = yield* EventLog;
      return [
        yield* log.commit('org-a', 't1', () => Effect.succeed([change('a')])),
        yield* log.commit('org-a', 't2', () =>
          Effect.succeed([
            { model: 'Card', id: 'a', action: 'delete', data: null, groups: ['org:a'] },
          ]),
        ),
      ];
    }),
  );
  expect(ids).toEqual([1, 2]);
});
