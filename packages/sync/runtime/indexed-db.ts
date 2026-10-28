import type { LocalDatabase } from '@repo/sync/types/local-database';
import { openDB } from 'idb';

const store = 'pool';
const key = 'state';

/**
 * The web adapter of the local database: one IndexedDB store that holds the
 * pool state under one key. Only the sync engine reads or writes it.
 */
export async function openIndexedDb(name: string): Promise<LocalDatabase> {
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
