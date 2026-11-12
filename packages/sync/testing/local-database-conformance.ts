import type { LocalDatabase, PoolState } from '@repo/sync/types/local-database';

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

/** A state with a confirmed record, a loaded group and one pending transaction. */
function sampleState(title = 'Old'): PoolState {
  return {
    lastSyncId: 7,
    tables: { Card: [{ id: 'a', title }] },
    groups: ['test'],
    meta: { 'Card\u0000a': { groups: ['test'], syncId: 7 } },
    pending: [{ id: 't1', command: 'cards/rename', input: { id: 'a', title: 'New' } }],
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
    name: 'a written state reads back deep-equal, with every field',
    async run(open) {
      const db = await open();
      const state = sampleState();
      await db.write(state);
      expectSame(await db.read(), state, 'The read after one write');
    },
  },
  {
    name: 'a second write replaces the first',
    async run(open) {
      const db = await open();
      await db.write(sampleState('Old'));
      const second = sampleState('Second');
      await db.write(second);
      expectSame(await db.read(), second, 'The read after two writes');
    },
  },
  {
    name: 'clear makes the next read undefined, and a write after a clear reads back',
    async run(open) {
      const db = await open();
      await db.write(sampleState());
      await db.clear();
      expectSame(await db.read(), undefined, 'The read after clear');
      const after = sampleState('After');
      await db.write(after);
      expectSame(await db.read(), after, 'The read after a write that follows clear');
    },
  },
  {
    name: 'a value that read returned is a copy, so a change to it leaves the database as it was',
    async run(open) {
      const db = await open();
      const state = sampleState();
      await db.write(state);
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
      await first.write(state);
      const second = await open();
      expectSame(await second.read(), state, 'The read through the second handle');
    },
  },
];
