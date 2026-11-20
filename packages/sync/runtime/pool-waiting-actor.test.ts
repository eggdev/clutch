import { expect, test } from 'bun:test';

import { defineContract } from '@repo/sync/contract/define';
import { loadPool } from '@repo/sync/runtime/boot';
import { createPool } from '@repo/sync/runtime/pool';
import { stateOf } from '@repo/sync/runtime/pool-doors';
import { memoryLocalDatabase } from '@repo/sync/testing/local-database';
import { poolState, testCommand, testModel, testStamps } from '@repo/sync/testing/pool-state';
import type { PoolState } from '@repo/sync/types/local-database';
import type { SyncActor } from '@repo/sync/types/protocol';

/**
 * The actor of each saved waiting transaction. A row of another actor is
 * dropped and never sent. A row with no actor takes the actor that the
 * server confirms next.
 */

const card = testModel('Card', { id: 'string', title: 'string' });
const archive = testCommand('cards/archive', { id: 'string' }, 'server');
const declared = { records: [card], commands: [archive] };
const cards = defineContract('cards', { records: [card], commands: [archive], loads: [] });

const ana = { userId: 'ana', organizationId: 'acme' };
const ben = { userId: 'ben', organizationId: 'acme' };

const otherActor =
  'This device held unsent changes of another account, so the app removed them and did not send them.';

/** A copy with one record, a position of `owner`, and one waiting row for each actor in `rows`. */
function copyOf(
  owner: SyncActor | undefined,
  rows: ReadonlyArray<SyncActor | undefined>,
): PoolState {
  return {
    ...poolState({
      lastSyncId: 9,
      tables: { Card: [{ id: 'a', title: 'Saved' }] },
      pending: rows.map((actor, index) => ({
        id: `t${index + 1}`,
        command: 'cards/archive',
        input: { id: 'a' },
        ...(actor ? { actor } : {}),
      })),
    }),
    ...(owner ? { actor: owner } : {}),
  };
}

function reportingPool() {
  const lines: Array<string> = [];
  const pool = createPool([], declared, {
    stamps: testStamps(),
    report: (line) => lines.push(line),
  });
  return { pool, lines };
}

/** Lets each save that waits for a microtask run. */
const settle = () =>
  new Promise((resolve) => {
    setTimeout(resolve, 10);
  });

test('a row of another actor than the saved position is dropped at the load, and removed from the device', async () => {
  // Ana's tab saved a row after Ben's tab wrote a position with Ben.
  const memory = memoryLocalDatabase(copyOf(ben, [ana]));
  const lines: Array<string> = [];
  const pool = await loadPool(memory, [], [cards], testStamps(), (line) => lines.push(line));
  expect(pool.queue()).toEqual([]);
  expect(pool.unsent()).toEqual([]);
  expect(lines).toEqual([otherActor]);
  await settle();
  const saved = await memory.read();
  expect(saved?.pending).toEqual([]);
});

test('the confirmed actor drops each row of another actor, and a row with no actor takes it', () => {
  const { pool, lines } = reportingPool();
  pool.load(copyOf(undefined, [ana, undefined, ben]));
  expect(pool.confirmActor(ben)).toBe(true);
  expect(pool.queue().map(({ id }) => id)).toEqual(['t2', 't3']);
  expect(pool.queue().map(({ actor }) => actor)).toEqual([ben, ben]);
  expect(pool.unsent().map(({ id }) => id)).toEqual(['t2', 't3']);
  expect(lines).toEqual([otherActor]);
});

test('a run after the actor is known saves the actor in its row, and sends no actor', async () => {
  const memory = memoryLocalDatabase(copyOf(ana, []));
  const pool = await loadPool(memory, [], [cards], testStamps());
  pool.run(archive, { id: 'a' });
  await settle();
  const saved = await memory.read();
  expect(saved?.pending.map(({ actor }) => actor)).toEqual([ana]);
  expect(pool.unsent()).toEqual([{ id: 'id-1', command: 'cards/archive', input: { id: 'a' } }]);
});

test('a run before the actor is known saves no actor, and the row takes the next confirmed actor', async () => {
  const memory = memoryLocalDatabase();
  const pool = await loadPool(memory, [], [cards], testStamps());
  pool.run(archive, { id: 'a' });
  await settle();
  const saved = await memory.read();
  expect(saved?.pending.map(({ actor }) => actor)).toEqual([undefined]);
  expect(pool.confirmActor(ana)).toBe(true);
  expect(pool.queue().map(({ actor }) => actor)).toEqual([ana]);
});

test('a read leaves out a waiting row with an actor of another shape', () => {
  const read = stateOf([], undefined, [
    { id: 't1', command: 'cards/archive', input: {}, actor: { userId: 7 } },
    { id: 't2', command: 'cards/archive', input: {}, actor: ana },
  ]);
  expect(read?.pending.map(({ id }) => id)).toEqual(['t2']);
});
