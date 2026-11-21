import { expect, test } from 'bun:test';

import { defineContract } from '@repo/sync/contract/define';
import { organizationGroup } from '@repo/sync/contract/engine-groups';
import { record } from '@repo/sync/contract/record';
import { trimLog } from '@repo/sync/repo/trim';
import { Database } from '@repo/sync/service/database';
import { EventLog, eventLog } from '@repo/sync/service/event-log';
import { feed } from '@repo/sync/service/feed';
import type { LoadRequest } from '@repo/sync/service/feed';
import { DatabaseTest } from '@repo/sync/testing/database';
import type { Change, SyncMessage } from '@repo/sync/types/protocol';
import { Effect, Layer, Queue, Stream } from 'effect';
import type { Context } from 'effect';

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

type Log = Context.Service.Shape<typeof EventLog>;

function run<A, E>(program: Effect.Effect<A, E, EventLog | Database>) {
  return Effect.runPromise(
    program.pipe(
      Effect.provide(Layer.provideMerge(eventLog([cards], { pageSize: 1 }), DatabaseTest())),
    ),
  );
}

/** Five events of `org-a`, then a trim that keeps only the newest one, sync ID 5. */
const fiveThenTrim = Effect.gen(function* () {
  const log = yield* EventLog;
  for (const id of ['a', 'b', 'c', 'd', 'e']) {
    yield* log.commit('org-a', `t-${id}`, () => Effect.succeed([upsert(id)]));
  }
  yield* trimLog(yield* Database, new Date(Date.now() + 60_000));
});

/** The messages of a client of `org:a` at `lastSyncId`, or its failure, up to `count` messages. */
const pull = (log: Log, lastSyncId: number, count: number) =>
  Effect.gen(function* () {
    const requests = yield* Queue.unbounded<LoadRequest>();
    return yield* feed(log, {
      organizationId: 'org-a',
      userId: 'u',
      lastSyncId,
      loaded: ['org:a'],
      granted: Effect.succeed({ eager: ['org:a'], lazy: [] }),
      requests,
    }).pipe(Stream.take(count), Stream.runCollect, Effect.timeout('2 seconds'), Effect.flip);
  });

test('a client whose last sync ID the trim dropped gets ServerBehind with the oldest kept event', async () => {
  const failure = await run(
    Effect.gen(function* () {
      yield* fiveThenTrim;
      return yield* pull(yield* EventLog, 3, 2);
    }),
  );
  expect(failure).toMatchObject({ _tag: 'ServerBehind', head: 5, oldest: 5 });
});

test('a client right before the oldest kept event still gets the events after it', async () => {
  const messages = await run(
    Effect.gen(function* () {
      yield* fiveThenTrim;
      const log = yield* EventLog;
      const requests = yield* Queue.unbounded<LoadRequest>();
      return yield* feed(log, {
        organizationId: 'org-a',
        userId: 'u',
        lastSyncId: 4,
        loaded: ['org:a'],
        granted: Effect.succeed({ eager: ['org:a'], lazy: [] }),
        requests,
      }).pipe(Stream.take(2), Stream.runCollect, Effect.timeout('2 seconds'));
    }),
  );
  expect(messages.map((message) => message._tag)).toEqual(['Groups', 'Deltas']);
  expect(
    messages[1]?._tag === 'Deltas' ? messages[1].deltas.map((delta) => delta.syncId) : [],
  ).toEqual([5]);
});

test('a trim that runs while the backlog is read ends the pull with ServerBehind', async () => {
  const failure = await run(
    Effect.gen(function* () {
      const log = yield* EventLog;
      for (const id of ['a', 'b', 'c', 'd', 'e']) {
        yield* log.commit('org-a', `t-${id}`, () => Effect.succeed([upsert(id)]));
      }
      const db = yield* Database;
      // One event a page. The trim runs after the first page of the backlog,
      // so events 3 and 4 are gone before the client reads them.
      let trimmed = false;
      const trimmedDuringBacklog: Log = {
        ...log,
        backlog: (organizationId, after, groups) =>
          log.backlog(organizationId, after, groups).pipe(
            Stream.tap(() =>
              trimmed
                ? Effect.void
                : Effect.gen(function* () {
                    trimmed = true;
                    yield* trimLog(db, new Date(Date.now() + 60_000));
                  }),
            ),
          ),
      };
      return yield* pull(trimmedDuringBacklog, 1, 10);
    }),
  );
  expect(failure).toMatchObject({ _tag: 'ServerBehind', oldest: 5 });
});

test('a trim that runs while the backlog is read sends no delta at the head before ServerBehind', async () => {
  const result = await run(
    Effect.gen(function* () {
      const log = yield* EventLog;
      for (const id of ['a', 'b', 'c', 'd']) {
        yield* log.commit('org-a', `t-${id}`, () => Effect.succeed([upsert(id)]));
      }
      // The newest event is in a group that the client did not load.
      yield* log.commit('org-a', 't-e', () =>
        Effect.succeed([{ ...upsert('e'), groups: ['org:a', 'space:y'] }]),
      );
      yield* log.commit('org-a', 't-f', () =>
        Effect.succeed([{ ...upsert('f'), groups: ['space:y'] }]),
      );
      const db = yield* Database;
      let trimmed = false;
      const trimmedDuringBacklog: Log = {
        ...log,
        backlog: (organizationId, after, groups) =>
          log.backlog(organizationId, after, groups).pipe(
            Stream.tap(() =>
              trimmed
                ? Effect.void
                : Effect.gen(function* () {
                    trimmed = true;
                    yield* trimLog(db, new Date(Date.now() + 60_000));
                  }),
            ),
          ),
      };
      const requests = yield* Queue.unbounded<LoadRequest>();
      const sent: Array<SyncMessage> = [];
      const ended = yield* feed(trimmedDuringBacklog, {
        organizationId: 'org-a',
        userId: 'u',
        lastSyncId: 1,
        loaded: ['org:a'],
        granted: Effect.succeed({ eager: ['org:a'], lazy: [] }),
        requests,
      }).pipe(
        Stream.tap((message) => Effect.sync(() => sent.push(message))),
        Stream.runDrain,
        Effect.timeout('2 seconds'),
        Effect.flip,
      );
      return { ended, sent };
    }),
  );
  expect(result.ended).toMatchObject({ _tag: 'ServerBehind', oldest: 6 });
  const deltas = result.sent.flatMap((message) =>
    message._tag === 'Deltas' ? message.deltas : [],
  );
  expect(deltas.filter((delta) => delta.changes.length === 0)).toEqual([]);
});
