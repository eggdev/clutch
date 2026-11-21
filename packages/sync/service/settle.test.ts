import { expect, test } from 'bun:test';

import type { ServerChange } from '@repo/sync/commands/server-change.server';
import { EventLog } from '@repo/sync/service/event-log';
import { settle } from '@repo/sync/service/settle';
import { EffectDrizzleQueryError } from 'drizzle-orm/effect-core/errors';
import { Cause, Effect, Layer, Stream } from 'effect';
import { SqlError } from 'effect/sql';

const actor = { userId: 'u1', organizationId: 'org-a' };
// The log of each test decides the result, so the change itself writes nothing.
const change: ServerChange<never> = { name: 'cards/add', run: () => Effect.succeed([]) };
const transaction = { id: 't1', command: 'cards/add', input: { title: 'One' } };

/**
 * An event log whose database fails a number of commits with `error`, and
 * answers or not. With no `error`, a commit fails with a plain one. With
 * `dies`, a commit dies with the error, as a transaction whose rollback
 * fails does.
 */
function logThat(options: {
  readonly failures: number;
  readonly answers: boolean;
  readonly error?: unknown;
  readonly dies?: true;
}) {
  let commits = 0;
  const failed = (error: unknown) => (options.dies ? Effect.die(error) : Effect.fail(error));
  const layer = Layer.succeed(EventLog)({
    // Each run of the effect is one commit, as with the real log.
    commit: () =>
      Effect.suspend(() => {
        commits += 1;
        return commits > options.failures
          ? Effect.succeed(7)
          : failed(options.error ?? 'connection lost');
      }),
    head: () => (options.answers ? Effect.succeed(6) : Effect.fail('connection lost')),
    oldest: () => Effect.succeed(1),
    backlog: () => Stream.empty,
    snapshot: () => Stream.empty,
    subscribe: () => Effect.die('No test subscribes.'),
  });
  return { layer, commits: () => commits };
}

function settled(log: ReturnType<typeof logThat>) {
  return Effect.runPromise(
    settle(change, transaction, actor).pipe(
      Effect.map((outcome) => `${outcome.status} ${outcome.code ?? outcome.syncId}`),
      Effect.catchTag('ServerUnavailable', () => Effect.succeed('not tried')),
      Effect.provide(log.layer),
    ),
  );
}

test('one failed commit runs the change once more, and the write is accepted', async () => {
  const log = logThat({ failures: 1, answers: true });
  expect(await settled(log)).toBe('accepted 7');
  expect(log.commits()).toBe(2);
});

test('a change that fails twice while the database answers is final, so the client drops it', async () => {
  const log = logThat({ failures: 2, answers: true });
  expect(await settled(log)).toBe('rejected failed');
  expect(log.commits()).toBe(2);
});

test('a database that does not answer gives no outcome, so the client keeps the write', async () => {
  const log = logThat({ failures: 2, answers: false });
  expect(await settled(log)).toBe('not tried');
});

/**
 * A deadlock, as Drizzle gives it for a query: the query error holds the
 * `SqlError` of the driver, whose reason holds the error of the server with
 * its code.
 */
const deadlock = new EffectDrizzleQueryError({
  query: 'insert into cards values ($1)',
  params: undefined,
  cause: Cause.fail(
    new SqlError.SqlError({
      reason: new SqlError.DeadlockError({
        cause: Object.assign(new Error('deadlock detected'), { code: '40P01' }),
        message: 'PgConnection: Query failed',
        operation: 'query',
      }),
    }),
  ),
});

/** A connection that dropped, as the Postgres driver gives it. */
const droppedConnection = new SqlError.SqlError({
  reason: new SqlError.ConnectionError({
    cause: new Error('The socket closed.'),
    message: 'PgConnection: The connection closed',
    operation: 'query',
  }),
});

test('a change that meets a deadlock four times, and then works, is accepted', async () => {
  const log = logThat({
    failures: 4,
    answers: true,
    error: deadlock,
  });
  expect(await settled(log)).toBe('accepted 7');
  expect(log.commits()).toBe(5);
});

test('a change that meets a deadlock each time is not tried after five more runs, so the client keeps the write', async () => {
  const log = logThat({
    failures: 99,
    answers: true,
    error: deadlock,
  });
  expect(await settled(log)).toBe('not tried');
  expect(log.commits()).toBe(6);
});

test('a change whose connection drops each time, with a database that does not answer, is not tried', async () => {
  const log = logThat({
    failures: 99,
    answers: false,
    error: droppedConnection,
  });
  expect(await settled(log)).toBe('not tried');
  expect(log.commits()).toBe(6);
});

test('a change that fails each time with a plain error runs twice, as before', async () => {
  const log = logThat({ failures: 99, answers: true });
  expect(await settled(log)).toBe('rejected failed');
  expect(log.commits()).toBe(2);
});

test('a change whose transaction dies with a dropped connection runs again, and is accepted', async () => {
  const log = logThat({ failures: 2, answers: true, error: droppedConnection, dies: true });
  expect(await settled(log)).toBe('accepted 7');
  expect(log.commits()).toBe(3);
});

test('a change that dies with another defect runs once, and is final, as before', async () => {
  const log = logThat({
    failures: 99,
    answers: true,
    error: new Error('A broken rule'),
    dies: true,
  });
  expect(await settled(log)).toBe('rejected failed');
  expect(log.commits()).toBe(1);
});
