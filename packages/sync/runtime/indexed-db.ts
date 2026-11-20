import {
  emptiedPosition,
  leftBehind,
  markAfter,
  oldLayoutSave,
  roomCount,
  roomSave,
  stateOf,
} from '@repo/sync/runtime/pool-doors';
import type { MarkState } from '@repo/sync/runtime/pool-doors';
import type { LocalDatabase, LocalSave, SaveResult } from '@repo/sync/types/local-database';
import { openDB } from 'idb';
import type { IDBPDatabase, IDBPTransaction, OpenDBCallbacks } from 'idb';

/** One row for each confirmed record, keyed by its model and ID. */
const records = 'records';
/** One row for each waiting transaction, in the order the tabs added them. */
const transactions = 'transactions';
/**
 * One row, under the key `position`: the last sync ID, the loaded groups,
 * `leftOutBy` and the actor. A clear leaves the mark of a session end in
 * the same store, under the key `ended`, as its state. The generation of the
 * database is under the key `generation`, and the times that room was made
 * under the key `room`.
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

/** The key of the copies of database `name`. Each copy is under it and `:` and its own ID, so no copy writes over another. */
const copyKey = (name: string) => `local-database:${name}:rescue`;

/** Whether a copy of waiting rows under `prefix` waits in `localStorage`. A copy from before each had its own ID is under `prefix` itself. */
function hasCopy(prefix: string): boolean {
  const storage = globalThis.localStorage;
  return Array.from({ length: storage?.length ?? 0 }, (_, index) => storage?.key(index)).some(
    (key) => key === prefix || key?.startsWith(`${prefix}:`),
  );
}

/**
 * Reads the generation of `database` and the times that room was made, in
 * one database transaction, so two tabs that open at once read the same. It
 * writes back each copy of `name` first, with the module that only an open
 * after a lost database or a rebuild loads. A database from before the
 * generation gets a new one.
 */
async function openGeneration(
  database: IDBPDatabase,
  name: string,
): Promise<{ readonly generation: unknown; readonly room: number }> {
  if (hasCopy(copyKey(name))) {
    const { writeBack } = await import('@repo/sync/runtime/indexed-db-copies');
    await writeBack(database, copyKey(name));
  }
  const tx = database.transaction(stores, 'readwrite');
  const store = tx.objectStore(position);
  const found: unknown = await store.get('generation');
  let generation = found;
  generation ??= crypto.randomUUID();
  if (generation !== found) {
    await store.put(generation, 'generation');
  }
  const room = roomCount(await store.get('room'));
  await tx.done;
  return { generation, room };
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
 * `makeRoom` drops the confirmed records in one database transaction. When
 * that fails too, it deletes the database and creates it again, with a copy
 * of the waiting rows in `localStorage` until it writes them. An open writes
 * back a copy that is still there.
 *
 * Version 1 kept the whole state under one key. The upgrade moves its rows
 * into the new stores and deletes the old store. `version` is the version of
 * the layout. A test passes a later one, as a tab of a newer build does. See
 * docs/contributing/architecture/client.md#older-layouts.
 */
export async function openIndexedDb(name: string, version = 2): Promise<LocalDatabase> {
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
  const blocked = Promise.withResolvers<never>();
  const callbacks: OpenDBCallbacks<unknown> = {
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
    // A tab of a newer build asks for a new version, or a rebuild deletes
    // the database. This handle lets the database go, so it never blocks
    // them, and it can no longer save. `onLost` wakes first, so the app keeps
    // its whole queue in a copy that the next open writes back, then starts
    // again on the new database.
    blocking(_current, _next, event) {
      wake();
      if (event.target instanceof IDBDatabase) {
        event.target.close();
      }
    },
  };
  let database = await Promise.race([openDB(name, version, callbacks), blocked.promise]);
  // `openedRoom` is the count that this handle read. A save after it changed writes only the waiting rows.
  let { generation, room: openedRoom } = await openGeneration(database, name);
  // The copy that this handle keeps when it loses its database.
  const keptKey = `${copyKey(name)}:${crypto.randomUUID()}`;
  const writer = await writerOf(name);

  /** Deletes the database and creates it again with only what a device must keep. */
  async function recreate(): Promise<SaveResult> {
    const { rebuild } = await import('@repo/sync/runtime/indexed-db-copies');
    const rebuilt = await rebuild({
      database,
      name,
      version,
      callbacks,
      generation,
      key: `${copyKey(name)}:${crypto.randomUUID()}`,
      reopen: (next) => openGeneration(next, name),
    });
    if (rebuilt === 'cleared') {
      return 'cleared';
    }
    database = rebuilt;
    return 'saved';
  }

  /** Drops each confirmed record, empties the position and counts the room made, in one database transaction. */
  async function dropRecords(): Promise<SaveResult> {
    const tx = database.transaction(stores, 'readwrite');
    const store = tx.objectStore(position);
    const [current, saved, room]: Array<unknown> = await Promise.all([
      store.get('generation'),
      store.get('position'),
      store.get('room'),
    ]);
    if (current !== generation) {
      await tx.done;
      return 'cleared';
    }
    const emptied = emptiedPosition(saved);
    await Promise.all([
      emptied ? store.put(emptied, 'position') : store.delete('position'),
      store.put(roomCount(room) + 1, 'room'),
      tx.objectStore(records).clear(),
      tx.done,
    ]);
    return 'saved';
  }

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
      const [current, room]: Array<unknown> = await Promise.all([
        tx.objectStore(position).get('generation'),
        tx.objectStore(position).get('room'),
      ]);
      const result: SaveResult = current === generation ? 'saved' : 'cleared';
      const written = roomSave(save, openedRoom, roomCount(room));
      await Promise.all([result === 'saved' ? write(tx, written) : undefined, tx.done]);
      if (result === 'cleared') {
        wake();
      }
      return result;
    },
    makeRoom: async () => {
      let result: SaveResult;
      try {
        result = await dropRecords();
      } catch {
        result = await recreate();
      }
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
      openedRoom = 0;
    },
    onLost(listener) {
      heard.add(listener);
      return () => heard.delete(listener);
    },
    keep(rows) {
      try {
        localStorage.setItem(keptKey, JSON.stringify({ generation, waiting: rows }));
      } catch {
        // A device too full for the copy keeps only the rows that it saved.
      }
    },
    isWriter: () => writer.held,
    writer: writer.taken,
  };
}
