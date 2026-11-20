import { expect, test } from 'bun:test';

import { defineContract } from '@repo/sync/contract/define';
import { organizationGroup } from '@repo/sync/contract/engine-groups';
import { record } from '@repo/sync/contract/record';
import { DatabasePostgres } from '@repo/sync/runtime/database.server';
import { migrateSync } from '@repo/sync/runtime/migrate.server';
import { Database } from '@repo/sync/service/database';
import { EventLog, eventLog } from '@repo/sync/service/event-log';
import { Wake } from '@repo/sync/service/wake';
import {
  describeOnPostgres,
  freshDatabase,
  listeners,
  listening,
  repeatUntil,
} from '@repo/sync/testing/postgres';
import type { Change } from '@repo/sync/types/protocol';
import { sql } from 'drizzle-orm';
import { Context, Effect, Fiber, Layer, Logger, PubSub, Stream } from 'effect';

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

/**
 * One server process: its own pool of connections to the database of `url`,
 * its own wake, and its own event log. The timed read of the log runs once an
 * hour, so in a test only a wake can make a reader read.
 */
const serverProcess = (url: string) =>
  eventLog([cards], { rereadEvery: '1 hour' }).pipe(Layer.provideMerge(DatabasePostgres(url)));

/** Two processes over one new database, migrated by the first. */
const twoProcesses = (serverUrl: string) =>
  Effect.gen(function* () {
    const urlOf = yield* freshDatabase(serverUrl);
    const first = yield* Layer.build(serverProcess(urlOf('first')));
    yield* migrateSync(Context.get(first, Database));
    const second = yield* Layer.build(serverProcess(urlOf('second')));
    return { first, second };
  });

const commitCard = (log: Context.Service.Shape<typeof EventLog>, id: string) =>
  log.commit('org-a', `t-${id}`, () => Effect.succeed([upsert(id)]));

describeOnPostgres('the event log on a real Postgres server', (serverUrl) => {
  test('commits at once through one process reach a subscriber of another in sync ID order, each once', async () => {
    const count = 300;
    const result = await Effect.runPromise(
      Effect.gen(function* () {
        const { first, second } = yield* twoProcesses(serverUrl);
        const writer = Context.get(first, EventLog);
        const subscription = yield* Context.get(second, EventLog).subscribe('org-a');
        const reading = yield* Stream.fromSubscription(subscription).pipe(
          Stream.take(count),
          Stream.runCollect,
          Effect.forkChild,
        );
        // Thirty commits at a time, so commits overlap and their wakes cross each other.
        yield* Effect.forEach(
          Array.from({ length: count }, (_, index) => `c${index + 1}`),
          (id) => commitCard(writer, id),
          { concurrency: 30 },
        );
        const deltas = yield* Fiber.join(reading);
        // One more commit. The next delta is its event, so no event came twice before it.
        yield* commitCard(writer, 'last');
        const next = yield* PubSub.take(subscription);
        return { syncIds: deltas.map((delta) => delta.syncId), next: next.syncId };
      }).pipe(Effect.scoped),
    );
    expect(result.syncIds).toEqual(Array.from({ length: count }, (_, index) => index + 1));
    expect(result.next).toBe(count + 1);
  }, 30_000);

  test('a dropped LISTEN connection listens again, and the event committed while it was down reaches the subscriber', async () => {
    const warnings: Array<string> = [];
    const keep = Logger.make(({ logLevel, message }) => {
      if (logLevel === 'Warn') {
        warnings.push(String(Array.isArray(message) ? message[0] : message));
      }
    });
    const result = await Effect.runPromise(
      Effect.gen(function* () {
        const { first, second } = yield* twoProcesses(serverUrl);
        const db = Context.get(first, Database);
        const writer = Context.get(first, EventLog);
        const subscription = yield* Context.get(second, EventLog).subscribe('org-a');
        const listener = yield* listening(db, 'second');
        // The path works before the drop.
        yield* commitCard(writer, 'before');
        const before = yield* PubSub.take(subscription);
        const listeningAgain = yield* Context.get(second, Wake).signals.pipe(
          Stream.filter((signal) => signal.kind === 'listening'),
          Stream.take(1),
          Stream.runDrain,
          Effect.forkChild,
        );
        yield* db.execute(sql`select pg_terminate_backend(${listener})`);
        yield* repeatUntil(
          Effect.sync(() => warnings),
          (logged) => logged.includes('The sync wake stopped listening'),
        );
        // The wake listens again a second after it stops, so this commit falls in the gap.
        yield* commitCard(writer, 'during');
        const whileDown = yield* listeners(db, 'second');
        yield* Fiber.join(listeningAgain);
        const during = yield* PubSub.take(subscription);
        return {
          before: before.syncId,
          whileDown,
          during: during.syncId,
          after: yield* listeners(db, 'second'),
        };
      }).pipe(Effect.scoped, Effect.provide(Logger.layer([keep]))),
    );
    expect(result.before).toBe(1);
    // No backend of the second process listened when the event was committed.
    expect(result.whileDown).toEqual([]);
    expect(result.during).toBe(2);
    expect(result.after).toHaveLength(1);
    // The wake that listened again made the reader read. The timed read never ran, and no wake was lost unseen.
    expect(warnings.filter((warning) => warning.startsWith('A timed read'))).toEqual([]);
  }, 30_000);
});
