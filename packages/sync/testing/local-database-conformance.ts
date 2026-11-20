import { fullSave } from '@repo/sync/runtime/pool-doors';
import type { LocalDatabase, PoolState } from '@repo/sync/types/local-database';
import type { Transaction } from '@repo/sync/types/protocol';

/** The confirmed part of a save with no record, and a position that names no actor. */
function positionOnly() {
  return {
    replace: false,
    put: [],
    remove: [],
    position: { lastSyncId: 7, groups: ['test'] },
  };
}

/**
 * One case that every local database adapter must pass. `run` gets `open`,
 * which gives a handle to one database. A second call in the same case gives
 * a second handle to the same stored data. `run` throws an error that says
 * what was expected and what was found.
 */
export type LocalDatabaseCase = {
  readonly name: string;
  readonly run: (open: () => Promise<LocalDatabase>) => Promise<void>;
};

/** A waiting transaction that renames the card `a`. */
function rename(id: string, title = 'New'): Transaction {
  return { id, command: 'cards/rename', input: { id: 'a', title } };
}

/** A state of one actor, with two confirmed records, a loaded group and one pending transaction. */
function sampleState(title = 'Old'): PoolState {
  return {
    lastSyncId: 7,
    tables: {
      Card: [
        { id: 'a', title },
        { id: 'b', title: 'Kept' },
      ],
    },
    groups: ['test'],
    meta: {
      'Card\u0000a': { groups: ['test'], syncId: 7 },
      'Card\u0000b': { groups: ['test'], syncId: 5 },
    },
    pending: [rename('t1')],
    leftOutBy: 'old-build',
    actor: { userId: 'ana', organizationId: 'acme' },
  };
}

/** Whether two JSON values hold the same data, with the keys in any order. */
function sameJson(a: unknown, b: unknown): boolean {
  if (Object.is(a, b)) {
    return true;
  }
  if (Array.isArray(a) && Array.isArray(b)) {
    return a.length === b.length && a.every((item, index) => sameJson(item, b[index]));
  }
  if (a && b && typeof a === 'object' && typeof b === 'object') {
    const aKeys = Object.keys(a);
    return (
      aKeys.length === Object.keys(b).length &&
      aKeys.every((key) => sameJson(Reflect.get(a, key), Reflect.get(b, key)))
    );
  }
  return false;
}

/** Throws when a value is not the expected one, and says both. */
function expectSame(actual: unknown, expected: unknown, what: string): void {
  if (!sameJson(actual, expected)) {
    throw new Error(
      `${what}: expected ${JSON.stringify(expected)}, found ${JSON.stringify(actual)}.`,
    );
  }
}

/** Reads the state, and throws when the database has none. */
async function readState(db: LocalDatabase, what: string): Promise<PoolState> {
  const state = await db.read();
  if (state === undefined) {
    throw new Error(`${what}: expected a saved state, found undefined.`);
  }
  return state;
}

const { actor: _noActor, ...oldLayout } = sampleState('Old layout');

/**
 * A copy in the old layout: one value that held the whole state. The old
 * layout named no actor. An adapter test stores it where the old adapter
 * kept it, opens the adapter, and passes the handle to `expectOldLayoutMoved`.
 */
export const oldLayoutCopy: PoolState = oldLayout;

/** Throws unless the handle reads the old copy whole, its waiting transaction included. */
export async function expectOldLayoutMoved(db: LocalDatabase): Promise<void> {
  expectSame(await db.read(), oldLayoutCopy, 'The read of a copy in the old layout');
}

/** The cases that every local database adapter must pass, in the order they run. */
export const localDatabaseCases: ReadonlyArray<LocalDatabaseCase> = [
  {
    name: 'a database that was never written reads as undefined',
    async run(open) {
      const db = await open();
      expectSame(await db.read(), undefined, 'The first read');
    },
  },
  {
    name: 'a full save reads back deep-equal, with every field',
    async run(open) {
      const db = await open();
      const state = sampleState();
      await db.save(fullSave(state));
      expectSame(await db.read(), state, 'The read after one save');
    },
  },
  {
    name: 'a second full save replaces the confirmed records and the position of the first',
    async run(open) {
      const db = await open();
      await db.save(fullSave(sampleState('Old')));
      const second: PoolState = {
        lastSyncId: 9,
        tables: { Card: [{ id: 'c', title: 'Only' }] },
        groups: ['other'],
        meta: { 'Card\u0000c': { groups: ['other'], syncId: 9 } },
        pending: [rename('t1')],
      };
      await db.save(fullSave(second));
      expectSame(await db.read(), second, 'The read after two full saves');
    },
  },
  {
    name: 'a save of one change writes that record and the position, and keeps every other record',
    async run(open) {
      const db = await open();
      await db.save(fullSave(sampleState()));
      await db.save({
        confirmed: {
          replace: false,
          put: [
            { model: 'Card', id: 'c', row: { id: 'c', title: 'New' }, groups: ['test'], syncId: 8 },
          ],
          remove: [{ model: 'Card', id: 'a' }],
          position: { lastSyncId: 8, groups: ['test'] },
        },
        add: [],
        done: [],
      });
      expectSame(
        await db.read(),
        {
          lastSyncId: 8,
          tables: {
            Card: [
              { id: 'b', title: 'Kept' },
              { id: 'c', title: 'New' },
            ],
          },
          groups: ['test'],
          meta: {
            'Card\u0000b': { groups: ['test'], syncId: 5 },
            'Card\u0000c': { groups: ['test'], syncId: 8 },
          },
          pending: [rename('t1')],
        },
        'The read after a save of one change',
      );
    },
  },
  {
    name: 'a deleted record keeps its sync ID, with no record, in a full save and in a save of one change',
    async run(open) {
      const db = await open();
      const state: PoolState = {
        ...sampleState(),
        meta: {
          ...sampleState().meta,
          'Card\u0000gone': { groups: ['test'], syncId: 6, deleted: true },
        },
      };
      await db.save(fullSave(state));
      expectSame(await db.read(), state, 'The read after a full save with a deleted record');
      await db.save({
        confirmed: {
          replace: false,
          put: [{ model: 'Card', id: 'b', row: null, groups: ['test'], syncId: 8 }],
          remove: [],
          position: { lastSyncId: 8, groups: ['test'] },
        },
        add: [],
        done: [],
      });
      const after = await readState(db, 'The read after a delete of b');
      expectSame(
        after.tables,
        { Card: [{ id: 'a', title: 'Old' }] },
        'The records after a delete of b',
      );
      expectSame(
        after.meta['Card\u0000b'],
        { groups: ['test'], syncId: 8, deleted: true },
        'The entry of b after its delete',
      );
    },
  },
  {
    name: 'a waiting transaction of one tab stays after a save of another tab',
    async run(open) {
      const first = await open();
      const second = await open();
      await first.save({ add: [rename('mine', 'Offline')], done: [] });
      // The other tab saves its whole state, with its own queue, and its own transaction leaves its queue.
      await second.save(fullSave({ ...sampleState(), pending: [rename('theirs')] }));
      await second.save({ add: [], done: ['theirs'] });
      const after = await readState(first, 'The read after the save of the other tab');
      expectSame(
        after.pending,
        [rename('mine', 'Offline')],
        'The waiting transactions after the save of the other tab',
      );
    },
  },
  {
    name: 'waiting transactions read in the order they were added, and a second add keeps the first place',
    async run(open) {
      const db = await open();
      await db.save({ add: [rename('t1'), rename('t2')], done: [] });
      await db.save({ add: [rename('t3'), rename('t1')], done: ['unknown'] });
      await db.save({ add: [], done: ['t2'] });
      const after = await readState(db, 'The read after three saves');
      expectSame(
        after.pending.map(({ id }) => id),
        ['t1', 't3'],
        'The order of the waiting transactions',
      );
    },
  },
  {
    name: 'a waiting row keeps its actor, and a row with no actor reads with none',
    async run(open) {
      const db = await open();
      const actor = { userId: 'ana', organizationId: 'acme' };
      await db.save({ add: [{ ...rename('t1'), actor }, rename('t2')], done: [] });
      const read = await readState(db, 'The read of the waiting rows');
      expectSame(read.pending, [{ ...rename('t1'), actor }, rename('t2')], 'The waiting rows');
    },
  },
  {
    name: 'a clear leaves a mark, and a waiting row saved after it reads with the mark',
    async run(open) {
      const db = await open();
      await db.save(fullSave(sampleState()));
      await db.clear();
      expectSame(await db.read(), undefined, 'The read of the mark alone');
      await db.save({ add: [rename('t9')], done: [] });
      const read = await readState(db, 'The read of a row saved after the clear');
      expectSame(read.ended, true, 'The mark of the session end');
      expectSame(read.pending, [rename('t9')], 'The waiting rows after the clear');
    },
  },
  {
    name: 'the first save of a position with an actor removes the mark and each waiting row with no actor',
    async run(open) {
      const db = await open();
      const actor = { userId: 'ben', organizationId: 'acme' };
      await db.clear();
      await db.save({ add: [rename('t1'), { ...rename('t2'), actor }], done: [] });
      const { position } = fullSave(sampleState()).confirmed ?? {};
      if (!position) {
        throw new Error('A full save has a position.');
      }
      await db.save({
        confirmed: { replace: true, put: [], remove: [], position: { ...position, actor } },
        add: [{ ...rename('t3'), actor }],
        done: [],
      });
      const read = await readState(db, 'The read after the save of the actor');
      expectSame(read.ended, undefined, 'The mark after the save of the actor');
      expectSame(
        read.pending.map(({ id }) => id),
        ['t2', 't3'],
        'The waiting rows that stay',
      );
    },
  },
  {
    name: 'the first save after a start keeps the mark, and a read after it gives no mark',
    async run(open) {
      const db = await open();
      const actor = { userId: 'ben', organizationId: 'acme' };
      await db.clear();
      await db.save({ add: [rename('t1')], done: [], afterLoad: true });
      const read = await readState(db, 'The read after the first save of a start');
      expectSame(read.ended, undefined, 'The mark after the first save of a start');
      expectSame(read.pending, [rename('t1')], 'The waiting rows after the first save');
      // The mark is still there: the save of an actor removes each row with no actor.
      await db.save({
        confirmed: { ...positionOnly(), position: { ...positionOnly().position, actor } },
        add: [{ ...rename('t2'), actor }],
        done: [],
      });
      const after = await readState(db, 'The read after the save of the actor');
      expectSame(
        after.pending.map(({ id }) => id),
        ['t2'],
        'The waiting rows after the save of the actor',
      );
    },
  },
  {
    name: 'a save after a Groups message that names no actor removes the mark and keeps each waiting row',
    async run(open) {
      const db = await open();
      const actor = { userId: 'ben', organizationId: 'acme' };
      await db.clear();
      await db.save({ add: [rename('t1')], done: [] });
      await db.save({ confirmed: { ...positionOnly(), heardServer: true }, add: [], done: [] });
      const read = await readState(db, 'The read after the Groups message');
      expectSame(read.ended, undefined, 'The mark after the Groups message');
      expectSame(read.pending, [rename('t1')], 'The waiting rows after the Groups message');
      // The mark is gone: a later save of an actor removes no row.
      await db.save({
        confirmed: { ...positionOnly(), position: { ...positionOnly().position, actor } },
        add: [],
        done: [],
      });
      const after = await readState(db, 'The read after the save of the actor');
      expectSame(after.pending, [rename('t1')], 'The waiting rows after the save of the actor');
    },
  },
  {
    name: 'a second add of a waiting row takes the new row and keeps its place',
    async run(open) {
      const db = await open();
      const actor = { userId: 'ana', organizationId: 'acme' };
      await db.save({ add: [rename('t1'), rename('t2')], done: [] });
      await db.save({ add: [{ ...rename('t1'), actor }], done: [] });
      const read = await readState(db, 'The read after the second add');
      expectSame(read.pending, [{ ...rename('t1'), actor }, rename('t2')], 'The waiting rows');
    },
  },
  {
    name: 'clear makes the next read undefined, and a save after a clear reads back',
    async run(open) {
      const db = await open();
      await db.save(fullSave(sampleState()));
      await db.clear();
      expectSame(await db.read(), undefined, 'The read after clear');
      const after = sampleState('After');
      await db.save(fullSave(after));
      expectSame(await db.read(), after, 'The read after a save that follows clear');
    },
  },
  {
    name: 'a value that read returned is a copy, so a change to it leaves the database as it was',
    async run(open) {
      const db = await open();
      const state = sampleState();
      await db.save(fullSave(state));
      // The types are readonly, so the writes go through Reflect, which the types allow.
      const first = await readState(db, 'The first read');
      Reflect.set(first, 'lastSyncId', 999);
      Reflect.set(first.pending, 'length', 0);
      const firstCard = first.tables.Card?.[0];
      if (firstCard) {
        Reflect.set(firstCard, 'title', 'Changed');
      }
      expectSame(await db.read(), state, 'The read after a change to the first read');
    },
  },
  {
    name: 'a second handle from open reads what the first handle wrote',
    async run(open) {
      const first = await open();
      const state = sampleState();
      await first.save(fullSave(state));
      const second = await open();
      expectSame(await second.read(), state, 'The read through the second handle');
    },
  },
];
