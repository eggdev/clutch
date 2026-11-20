import { oldLayoutSave, stateOf } from '@repo/sync/runtime/pool-doors';
import type { LocalDatabase, LocalSave } from '@repo/sync/types/local-database';
import { openDB } from 'idb';
import type { IDBPTransaction } from 'idb';

/** One row for each confirmed record, keyed by its model and ID. */
const records = 'records';
/** One row for each waiting transaction, in the order the tabs added them. */
const transactions = 'transactions';
/** One row, under the key `position`: the last sync ID, the loaded groups and `leftOutBy`. */
const position = 'position';
/** The store of the old layout, which held the whole state under the key `state`. */
const oldStore = 'pool';
const stores = [records, transactions, position];

type Writable = IDBPTransaction<unknown, ArrayLike<string>, 'readwrite' | 'versionchange'>;

/**
 * Writes one save in the database transaction `tx`. Each request joins the
 * same transaction, so the whole save commits or none of it does.
 */
async function write(tx: Writable, save: LocalSave): Promise<void> {
  const recordStore = tx.objectStore(records);
  const waiting = tx.objectStore(transactions);
  const requests: Array<Promise<unknown>> = [];
  const { confirmed } = save;
  if (confirmed) {
    requests.push(recordStore.clear());
    for (const record of confirmed.put) {
      requests.push(recordStore.put(record));
    }
    requests.push(tx.objectStore(position).put(confirmed.position, 'position'));
  }
  for (const id of save.done) {
    const key = await waiting.index('id').getKey(id);
    if (key !== undefined) {
      requests.push(waiting.delete(key));
    }
  }
  for (const transaction of save.add) {
    // A transaction that is saved already keeps its place in the order.
    if ((await waiting.index('id').getKey(transaction.id)) === undefined) {
      requests.push(waiting.add(transaction));
    }
  }
  await Promise.all(requests);
}

/**
 * The web adapter of the local database: one IndexedDB database with a store
 * for the confirmed records, one for the waiting transactions and one for
 * the sync position. Only the sync engine reads or writes it.
 *
 * Version 1 kept the whole state under one key. The upgrade moves its rows
 * into the new stores and deletes the old store. See
 * docs/contributing/architecture/client.md#older-layouts.
 */
export async function openIndexedDb(name: string): Promise<LocalDatabase> {
  const blocked = Promise.withResolvers<never>();
  const opening = openDB(name, 2, {
    async upgrade(upgrade, oldVersion, _newVersion, tx) {
      if (oldVersion >= 2) {
        return;
      }
      upgrade.createObjectStore(records, { keyPath: ['model', 'id'] });
      upgrade.createObjectStore(transactions, { autoIncrement: true }).createIndex('id', 'id', {
        unique: true,
      });
      upgrade.createObjectStore(position);
      if (upgrade.objectStoreNames.contains(oldStore)) {
        const old: unknown = await tx.objectStore(oldStore).get('state');
        upgrade.deleteObjectStore(oldStore);
        await write(tx, oldLayoutSave(old));
      }
    },
    blocked() {
      blocked.reject(
        new Error(
          'Another tab of this app runs an older build and holds its saved data. Close that tab, then start this one again.',
        ),
      );
    },
    blocking(_current, _next, event) {
      if (event.target instanceof IDBDatabase) {
        event.target.close();
      }
    },
  });
  const database = await Promise.race([opening, blocked.promise]);
  return {
    read: async () => {
      const tx = database.transaction(stores, 'readonly');
      const [rows, waiting, saved] = await Promise.all([
        tx.objectStore(records).getAll(),
        tx.objectStore(transactions).getAll(),
        tx.objectStore(position).get('position'),
        tx.done,
      ]);
      return stateOf(rows, saved, waiting);
    },
    save: async (save) => {
      const tx = database.transaction(stores, 'readwrite');
      await Promise.all([write(tx, save), tx.done]);
    },
    clear: async () => {
      const tx = database.transaction(stores, 'readwrite');
      await Promise.all([...stores.map((store) => tx.objectStore(store).clear()), tx.done]);
    },
  };
}
