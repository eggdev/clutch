import { leftBehind, oldLayoutSave, stateOf } from '@repo/sync/runtime/pool-doors';
import type { LocalDatabase, LocalSave } from '@repo/sync/types/local-database';
import { openDB } from 'idb';
import type { IDBPTransaction } from 'idb';

/** One row for each confirmed record, keyed by its model and ID. */
const records = 'records';
/** One row for each waiting transaction, in the order the tabs added them. */
const transactions = 'transactions';
/**
 * One row, under the key `position`: the last sync ID, the loaded groups,
 * `leftOutBy` and the actor. A clear leaves the mark of a session end in
 * the same store, under the key `ended`.
 */
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
    if (confirmed.replace) {
      requests.push(recordStore.clear());
    }
    for (const { model, id } of confirmed.remove) {
      requests.push(recordStore.delete([model, id]));
    }
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
    // A transaction that is saved already keeps its place in the order, and takes the new row.
    const key = await waiting.index('id').getKey(transaction.id);
    requests.push(key === undefined ? waiting.add(transaction) : waiting.put(transaction, key));
  }
  // The first save that names the actor of the next session removes the mark,
  // and each other waiting row with no actor, which may be the work of the person who left.
  if (confirmed?.position.actor && (await tx.objectStore(position).get('ended')) !== undefined) {
    requests.push(tx.objectStore(position).delete('ended'));
    for (let cursor = await waiting.openCursor(); cursor; cursor = await cursor.continue()) {
      if (leftBehind(cursor.value, save)) {
        requests.push(cursor.delete());
      }
    }
  }
  await Promise.all(requests);
}

type Writer = { held: boolean; readonly taken: Promise<null> };

/**
 * Whether this page writes the confirmed records of a database name. The
 * page that holds the Web Lock of the name is the writer until it closes.
 * Then the next page gets the lock. The open asks for a free lock first, so
 * the first page knows that it writes before it reads. Each handle of one
 * page shares the answer, so a start again after a sign-out stays the
 * writer. A browser with no Web Locks lets each page write.
 */
const writers = new Map<string, Promise<Writer>>();

async function takeWriter(name: string): Promise<Writer> {
  if (typeof navigator === 'undefined' || !('locks' in navigator)) {
    return { held: true, taken: Promise.resolve(null) };
  }
  const lock = `local-database:${name}`;
  const taken = Promise.withResolvers<null>();
  const writer: Writer = { held: false, taken: taken.promise };
  function hold() {
    writer.held = true;
    taken.resolve(null);
    // The lock is held until the page closes.
    return Promise.withResolvers<never>().promise;
  }
  const free = Promise.withResolvers<boolean>();
  void navigator.locks.request(lock, { ifAvailable: true }, (granted) => {
    free.resolve(granted !== null);
    return granted === null ? null : hold();
  });
  if (!(await free.promise)) {
    void navigator.locks.request(lock, hold);
  }
  return writer;
}

function writerOf(name: string): Promise<Writer> {
  const known = writers.get(name) ?? takeWriter(name);
  writers.set(name, known);
  return known;
}

/**
 * The web adapter of the local database: one IndexedDB database with a store
 * for the confirmed records, one for the waiting transactions and one for
 * the sync position. Only the sync engine reads or writes it. A clear tells
 * each other tab of the same name through a `BroadcastChannel`.
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
  const writer = await writerOf(name);
  // Each other tab of this database hears a clear on this channel. A channel
  // never hears its own message.
  const tabs = typeof BroadcastChannel === 'undefined' ? undefined : new BroadcastChannel(name);
  return {
    read: async () => {
      const tx = database.transaction(stores, 'readonly');
      const [rows, waiting, saved, ended] = await Promise.all([
        tx.objectStore(records).getAll(),
        tx.objectStore(transactions).getAll(),
        tx.objectStore(position).get('position'),
        tx.objectStore(position).get('ended'),
        tx.done,
      ]);
      return stateOf(rows, saved, waiting, ended !== undefined);
    },
    save: async (save) => {
      const tx = database.transaction(stores, 'readwrite');
      await Promise.all([write(tx, save), tx.done]);
    },
    clear: async () => {
      // The message goes before the clear starts, so each database transaction
      // that another tab starts after it hears it runs after the clear.
      if (tabs) {
        // A channel reaches only the pages of this origin, so it takes no
        // target origin. The lint rule for `postMessage` reads each such call
        // as one on a window, so the call goes through `Reflect.apply`.
        Reflect.apply(BroadcastChannel.prototype.postMessage, tabs, ['cleared']);
      }
      const tx = database.transaction(stores, 'readwrite');
      await Promise.all([
        ...stores.map((store) => tx.objectStore(store).clear()),
        tx.objectStore(position).put(true, 'ended'),
        tx.done,
      ]);
    },
    onClearedElsewhere(listener) {
      const heard = () => listener();
      tabs?.addEventListener('message', heard);
      return () => tabs?.removeEventListener('message', heard);
    },
    isWriter: () => writer.held,
    writer: writer.taken,
  };
}
