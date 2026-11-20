import { expect, test } from 'bun:test';

import { createPool } from '@repo/sync/runtime/pool';
import { stateOf } from '@repo/sync/runtime/pool-doors';
import { poolState, testCommand, testModel, testStamps } from '@repo/sync/testing/pool-state';
import type { PoolState } from '@repo/sync/types/local-database';

/**
 * The actor of a saved copy. The server names the actor of each connection
 * in the first `Groups` message of a pull. A copy of another actor is
 * dropped before the engine sends anything.
 */

const card = testModel('Card', { id: 'string', title: 'string' });
const archive = testCommand('cards/archive', { id: 'string' }, 'server');
const declared = { records: [card], commands: [archive] };

const ana = { userId: 'ana', organizationId: 'acme' };
const ben = { userId: 'ben', organizationId: 'acme' };

const anotherAccount =
  'This device held the data of another account, so the app removed it, with its unsent changes, and loads this account from the server.';

/** A copy of `actor` with one record, one loaded group and one waiting transaction. */
function copyOf(actor?: PoolState['actor']): PoolState {
  return {
    ...poolState({
      lastSyncId: 9,
      tables: { Card: [{ id: 'a', title: 'Saved' }] },
      pending: [{ id: 't1', command: 'cards/archive', input: { id: 'a' } }],
    }),
    ...(actor ? { actor } : {}),
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

test('the saved copy holds its actor', () => {
  const { pool } = reportingPool();
  pool.load(copyOf(ana));
  expect(pool.snapshot().actor).toEqual(ana);
  expect(pool.confirmedChanges(true).position.actor).toEqual(ana);
});

test('a copy of another actor is dropped whole, and the pool reports it once', () => {
  const { pool, lines } = reportingPool();
  pool.load(copyOf(ana));
  let woken = 0;
  pool.onChange(() => {
    woken += 1;
  });
  expect(pool.confirmActor(ben)).toBe(false);
  expect(pool.ids(card)).toEqual([]);
  expect(pool.loadedGroups()).toEqual([]);
  expect(pool.lastSyncId()).toBe(0);
  expect(pool.queue()).toEqual([]);
  expect(pool.snapshot().actor).toEqual(ben);
  expect(lines).toEqual([anotherAccount]);
  expect(woken).toBeGreaterThan(0);
  // The next save replaces every saved record, and names the new actor.
  const save = pool.confirmedChanges(false);
  expect(save.replace).toBe(true);
  expect(save.put).toEqual([]);
  expect(save.position).toEqual({ lastSyncId: 0, groups: [], actor: ben });
});

test('the same user in another organization is another actor', () => {
  const { pool } = reportingPool();
  pool.load(copyOf(ana));
  expect(pool.confirmActor({ userId: 'ana', organizationId: 'globex' })).toBe(false);
  expect(pool.ids(card)).toEqual([]);
});

test('a copy of the same actor stays', () => {
  const { pool, lines } = reportingPool();
  pool.load(copyOf(ana));
  expect(pool.confirmActor({ ...ana })).toBe(true);
  expect(pool.ids(card)).toEqual(['a']);
  expect(pool.queue()).toHaveLength(1);
  expect(lines).toEqual([]);
});

test('a copy from before the actor was saved takes the first actor that the server names', () => {
  const { pool, lines } = reportingPool();
  pool.load(copyOf());
  let woken = 0;
  pool.onChange(() => {
    woken += 1;
  });
  expect(pool.confirmActor(ana)).toBe(true);
  expect(pool.ids(card)).toEqual(['a']);
  expect(pool.queue()).toHaveLength(1);
  expect(pool.snapshot().actor).toEqual(ana);
  // The pool wakes its save, so the actor reaches the local database.
  expect(woken).toBe(1);
  expect(lines).toEqual([]);
});

test('a server that names no actor keeps the copy', () => {
  const { pool } = reportingPool();
  pool.load(copyOf(ana));
  expect(pool.confirmActor()).toBe(true);
  expect(pool.ids(card)).toEqual(['a']);
  expect(pool.snapshot().actor).toEqual(ana);
});

test('a reset after a database restore keeps the actor of the copy', () => {
  const { pool } = reportingPool();
  pool.load(copyOf(ana));
  pool.resetConfirmed();
  expect(pool.snapshot().actor).toEqual(ana);
});

test('a copy that does not fit its records keeps its actor, so its waiting work stays tied to it', () => {
  const { pool } = reportingPool();
  pool.load({ ...copyOf(ana), tables: { Card: [{ id: 'a', title: 7 }] } });
  expect(pool.ids(card)).toEqual([]);
  expect(pool.queue()).toHaveLength(1);
  expect(pool.confirmActor(ben)).toBe(false);
  expect(pool.queue()).toEqual([]);
});

test('a read of a position with an actor of another shape keeps no record and no position', () => {
  const read = stateOf([], { lastSyncId: 3, groups: [], actor: { userId: 7 } }, []);
  expect(read?.unreadable).toBe(true);
  expect(read?.actor).toBeUndefined();
  const fits = stateOf([], { lastSyncId: 3, groups: [], actor: ana }, []);
  expect(fits?.actor).toEqual(ana);
});
