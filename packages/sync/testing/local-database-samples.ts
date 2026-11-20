import type { LocalDatabase, PoolState } from '@repo/sync/types/local-database';
import type { Transaction } from '@repo/sync/types/protocol';

/*
 * The samples and the checks that the cases of each local database adapter
 * share. See `local-database-conformance.ts` for the cases.
 */

/** The confirmed part of a save with no record, and a position that names no actor. */
export function positionOnly() {
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
export function rename(id: string, title = 'New'): Transaction {
  return { id, command: 'cards/rename', input: { id: 'a', title } };
}

/** A state of one actor, with two confirmed records, a loaded group and one pending transaction. */
export function sampleState(title = 'Old'): PoolState {
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
export function sameJson(a: unknown, b: unknown): boolean {
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
export function expectSame(actual: unknown, expected: unknown, what: string): void {
  if (!sameJson(actual, expected)) {
    throw new Error(
      `${what}: expected ${JSON.stringify(expected)}, found ${JSON.stringify(actual)}.`,
    );
  }
}

/** Reads the state, and throws when the database has none. */
export async function readState(db: LocalDatabase, what: string): Promise<PoolState> {
  const state = await db.read();
  if (state === undefined) {
    throw new Error(`${what}: expected a saved state, found undefined.`);
  }
  return state;
}
