import type { LocalDatabase, PoolState } from '@repo/sync/types/local-database';

/** A local database in memory, for tests. It keeps a copy of each state it gets. */
export function memoryLocalDatabase(initial?: PoolState): LocalDatabase & {
  readonly writes: () => number;
} {
  let state = initial ? structuredClone(initial) : undefined;
  let writes = 0;
  return {
    read: () => Promise.resolve(state ? structuredClone(state) : undefined),
    write: (next) => {
      state = structuredClone(next);
      writes += 1;
      return Promise.resolve();
    },
    clear: () => {
      state = undefined;
      return Promise.resolve();
    },
    writes: () => writes,
  };
}
