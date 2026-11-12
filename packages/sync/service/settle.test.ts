import { expect, test } from 'bun:test';

import type { ServerChange } from '@repo/sync/commands/server-change.server';
import { EventLog } from '@repo/sync/service/event-log';
import { settle } from '@repo/sync/service/settle';
import { Effect, Layer, Stream } from 'effect';

const actor = { userId: 'u1', organizationId: 'org-a' };
// The log of each test decides the result, so the change itself writes nothing.
const change: ServerChange<never> = { name: 'cards/add', run: () => Effect.succeed([]) };
const transaction = { id: 't1', command: 'cards/add', input: { title: 'One' } };

/** An event log whose database fails a number of commits, and answers or not. */
function logThat(options: { readonly failures: number; readonly answers: boolean }) {
  let commits = 0;
  const layer = Layer.succeed(EventLog)({
    // Each run of the effect is one commit, as with the real log.
    commit: () =>
      Effect.suspend(() => {
        commits += 1;
        return commits > options.failures ? Effect.succeed(7) : Effect.fail('connection lost');
      }),
    head: () => (options.answers ? Effect.succeed(6) : Effect.fail('connection lost')),
    backlog: () => Stream.empty,
    backfill: () => Effect.succeed([]),
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
