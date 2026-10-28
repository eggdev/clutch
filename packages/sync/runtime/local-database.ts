import type { PoolState } from '@repo/sync/runtime/pool';
import { openDB } from 'idb';

/**
 * The local database: the confirmed records, the last sync ID and the
 * transactions that wait. It is IndexedDB on the web. Only the sync engine
 * reads or writes it.
 */
export type LocalDatabase = {
  readonly read: () => Promise<PoolState | undefined>;
  readonly write: (state: PoolState) => Promise<void>;
  readonly clear: () => Promise<void>;
};

const store = 'pool';
const key = 'state';

export async function openLocalDatabase(name: string): Promise<LocalDatabase> {
  const database = await openDB(name, 1, {
    upgrade(upgrade) {
      upgrade.createObjectStore(store);
    },
  });
  return {
    read: () => database.get(store, key),
    write: async (state) => {
      await database.put(store, state, key);
    },
    clear: async () => {
      await database.clear(store);
    },
  };
}
