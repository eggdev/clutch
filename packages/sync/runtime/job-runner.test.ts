import { expect, test } from 'bun:test';

import { defineContract } from '@repo/sync/contract/define';
import { organizationGroup } from '@repo/sync/contract/engine-groups';
import { job as declareJob } from '@repo/sync/contract/job';
import { record } from '@repo/sync/contract/record';
import { jobsNamed } from '@repo/sync/repo/jobs';
import { syncEvents } from '@repo/sync/repo/schema';
import {
  askForScheduledJobs,
  JobRunner,
  retryWait,
  runDueJobs,
} from '@repo/sync/runtime/job-runner.server';
import { Database } from '@repo/sync/service/database';
import { EventLog, eventLog } from '@repo/sync/service/event-log';
import { defineJob, defineSchedule, Outbox, OutboxLive } from '@repo/sync/service/jobs';
import { DatabaseTest } from '@repo/sync/testing/database';
import type { Change } from '@repo/sync/types/protocol';
import { eq } from 'drizzle-orm';
import { Cause, Effect, Exit, Layer } from 'effect';

/** A card of the organization, which the job writes. */
const cardRecord = record('Card', {
  fields: { id: 'string', title: 'string' },
  groups: [organizationGroup.ofScope],
});

const change = (id: string): Change => ({
  model: 'Card',
  id,
  action: 'upsert',
  data: { id, title: id },
  groups: ['org:org-a'],
});

let runs = 0;
const cardDeclaration = declareJob('test/card', { payload: { id: 'string' } });
const card = defineJob(cardDeclaration, ({ id }, { commit }) =>
  Effect.gen(function* () {
    runs += 1;
    yield* commit(() => Effect.succeed([change(id)]));
  }),
);
const cardContract = defineContract('test', {
  records: [cardRecord],
  commands: [],
  loads: [],
  jobs: [cardDeclaration],
});
const broken = defineJob(declareJob('test/broken', { payload: {} }), () =>
  Effect.fail(new Error('The vendor is down.')),
);

const services = Layer.mergeAll(eventLog([cardContract]), OutboxLive).pipe(
  Layer.provideMerge(DatabaseTest()),
);

function run<A, E>(program: Effect.Effect<A, E, Database | EventLog | Outbox>) {
  return Effect.runPromise(program.pipe(Effect.provide(services)));
}

/** Starts the job runner in a scope, then ends the scope. The exit says whether it started. */
function startRunner(runner: Layer.Layer<never, unknown, Database | EventLog>) {
  return Effect.runPromiseExit(Effect.scoped(Layer.build(runner)).pipe(Effect.provide(services)));
}

function causeOf(exit: Exit.Exit<unknown, unknown>) {
  return Exit.isFailure(exit) ? Cause.pretty(exit.cause) : '';
}

test('a job exists only when the transaction that asked for it commits', async () => {
  const names = await run(
    Effect.gen(function* () {
      const db = yield* Database;
      const outbox = yield* Outbox;
      const log = yield* EventLog;
      const options = { organizationId: 'org-a' };
      yield* log.commit('org-a', 'kept', (tx) =>
        outbox
          .enqueue(tx, card, { id: 'kept' }, { ...options, id: 'kept' })
          .pipe(Effect.as([change('kept')])),
      );
      yield* log
        .commit('org-a', 'dropped', (tx) =>
          outbox
            .enqueue(tx, card, { id: 'dropped' }, { ...options, id: 'dropped' })
            .pipe(Effect.andThen(Effect.fail('rolled back'))),
        )
        .pipe(Effect.ignore);
      return (yield* jobsNamed(db, 'test/card')).map((job) => job.id);
    }),
  );
  expect(names).toEqual(['kept']);
});

test('a job runs once, its ID ignores a repeat, and its commit reaches the event log once', async () => {
  runs = 0;
  const result = await run(
    Effect.gen(function* () {
      const db = yield* Database;
      const outbox = yield* Outbox;
      const options = { id: 'card-1', organizationId: 'org-a' };
      yield* outbox.enqueue(db, card, { id: 'c1' }, options);
      yield* outbox.enqueue(db, card, { id: 'c1' }, options);
      const first = yield* runDueJobs([card]);
      const second = yield* runDueJobs([card]);
      const [job] = yield* jobsNamed(db, 'test/card');
      const events = yield* db
        .select()
        .from(syncEvents)
        .where(eq(syncEvents.transactionId, 'job:card-1'));
      return { first, second, status: job?.status, events: events.length };
    }),
  );
  expect(result).toEqual({ first: 1, second: 0, status: 'done', events: 1 });
  expect(runs).toBe(1);
});

test('a failed job waits longer each time, then stays failed with its error', async () => {
  const [after, last] = await run(
    Effect.gen(function* () {
      const db = yield* Database;
      const outbox = yield* Outbox;
      yield* outbox.enqueue(db, broken, {}, { id: 'b1', organizationId: null });
      yield* runDueJobs([broken]);
      const [retried] = yield* jobsNamed(db, 'test/broken');
      // Make the job due at once, four more times, to reach the last attempt.
      for (let attempt = 0; attempt < 4; attempt += 1) {
        yield* db.execute("update sync_jobs set run_at = now() - interval '1 second'");
        yield* runDueJobs([broken]);
      }
      const [failed] = yield* jobsNamed(db, 'test/broken');
      return [retried, failed];
    }),
  );
  expect(after?.status).toBe('pending');
  expect(after?.attempts).toBe(1);
  expect(after?.lastError).toContain('The vendor is down.');
  expect(after && after.runAt.getTime()).toBeGreaterThan(Date.now());
  expect(last?.status).toBe('failed');
  expect(last?.attempts).toBe(5);
  expect([retryWait(0), retryWait(3), retryWait(20)]).toEqual([1000, 8000, 300_000]);
});

test('a schedule asks for one job each interval, and a job with no runner fails', async () => {
  const schedule = defineSchedule('test/hourly', {
    every: '1 hour',
    job: card,
    payload: { id: 'h' },
  });
  const jobs = await run(
    Effect.gen(function* () {
      const db = yield* Database;
      yield* askForScheduledJobs([schedule]);
      yield* askForScheduledJobs([schedule]);
      yield* runDueJobs<never>([]);
      return yield* jobsNamed(db, 'test/card');
    }),
  );
  expect(jobs).toHaveLength(1);
  expect(jobs[0]?.id).toStartWith('schedule:test/hourly:');
  expect(jobs[0]?.lastError).toBe('This server has no job named test/card.');
});

test('a job that a contract declares and no runner lists stops the runner at its start', async () => {
  const exit = await startRunner(JobRunner([], [], [cardContract], '1 hour'));
  expect(exit._tag).toBe('Failure');
  expect(causeOf(exit)).toContain(
    'The server app passes no job runner for: test/card. Add the jobs of each contract to the `jobs` list of the server app.',
  );
});

test('the same runner starts when it lists the declared job', async () => {
  const exit = await startRunner(JobRunner([card], [], [cardContract], '1 hour'));
  expect(exit._tag).toBe('Success');
});

test('a job that no contract declares does not stop the runner', async () => {
  const exit = await startRunner(JobRunner([card], [], [], '1 hour'));
  expect(exit._tag).toBe('Success');
});
