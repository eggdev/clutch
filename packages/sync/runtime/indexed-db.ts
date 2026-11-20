import { leftBehind, markAfter, oldLayoutSave, stateOf } from '@repo/sync/runtime/pool-doors';
import type { MarkState } from '@repo/sync/runtime/pool-doors';
import type { LocalDatabase, LocalSave, SaveResult } from '@repo/sync/types/local-database';
import { openDB } from 'idb';
import type { IDBPTransaction } from 'idb';

/** One row for each confirmed record, keyed by its model and ID. */
const records = 'records';
/** One row for each waiting transaction, in the order the tabs added them. */
const transactions = 'transactions';
/**
 * One row, under the key `position`: the last sync ID, the loaded groups,
 * `leftOutBy` and the actor. A clear leaves the mark of a session end in
 * the same store, under the key `ended`, as its state. The generation of the
 * database is under the key `generation`.
 */
const position = 'position';
/** The store of the old layout, which held the whole state under the key `state`. */
const oldStore = 'pool';
const stores = [records, transactions, position];

type Writable = IDBPTransaction<unknown, ArrayLike<string>, 'readwrite' | 'versionchange'>;

/** The state of the saved mark of a session end, if there is one. */
function markState(saved: unknown): MarkState | undefined {
  if (saved === undefined) {
    return undefined;
  }
  return saved === 'spent' ? 'spent' : 'fresh';
}

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
  // The first save of a start spends the mark. The first save after a
  // `Groups` message removes it. When that save names the actor of the next
  // session, it also removes each other waiting row with no actor, which may
  // be the work of the person who left.
  const before = markState(await tx.objectStore(position).get('ended'));
  const { mark, sweep } = markAfter(before, save);
  if (mark !== before) {
    requests.push(
      mark === undefined
        ? tx.objectStore(position).delete('ended')
        : tx.objectStore(position).put(mark, 'ended'),
    );
  }
  if (sweep) {
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
  // A database from before the generation gets one at its first open. The
  // read and the write share one database transaction, so two tabs that
  // open at once read the same generation.
  const first = database.transaction(position, 'readwrite');
  let generation: unknown = await first.store.get('generation');
  if (generation === undefined) {
    generation = crypto.randomUUID();
    await first.store.put(generation, 'generation');
  }
  await first.done;
  let lost = false;
  const heard = new Set<() => void>();
  function wake() {
    if (!lost) {
      lost = true;
      for (const listener of heard) {
        listener();
      }
    }
  }
  const writer = await writerOf(name);
  // Each other tab of this database hears a clear on this channel. A channel
  // never hears its own message.
  const tabs = typeof BroadcastChannel === 'undefined' ? undefined : new BroadcastChannel(name);
  tabs?.addEventListener('message', wake);
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
      return stateOf(rows, saved, waiting, markState(ended) === 'fresh');
    },
    save: async (save) => {
      const tx = database.transaction(stores, 'readwrite');
      const current: unknown = await tx.objectStore(position).get('generation');
      const result: SaveResult = current === generation ? 'saved' : 'cleared';
      await Promise.all([result === 'saved' ? write(tx, save) : undefined, tx.done]);
      if (result === 'cleared') {
        wake();
      }
      return result;
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
      const next = crypto.randomUUID();
      const tx = database.transaction(stores, 'readwrite');
      await Promise.all([
        ...stores.map((store) => tx.objectStore(store).clear()),
        tx.objectStore(position).put('fresh', 'ended'),
        tx.objectStore(position).put(next, 'generation'),
        tx.done,
      ]);
      generation = next;
    },
    onLost(listener) {
      heard.add(listener);
      return () => heard.delete(listener);
    },
    isWriter: () => writer.held,
    writer: writer.taken,
  };
}
