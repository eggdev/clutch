import { emptiedPosition, roomCount } from '@repo/sync/runtime/pool-doors';
import type { SyncPosition } from '@repo/sync/types/local-database';
import { deleteDB, openDB } from 'idb';
import type { IDBPDatabase, IDBPTransaction, OpenDBCallbacks } from 'idb';

/*
 * The copies of waiting rows that the web local database keeps in
 * `localStorage`, outside the database. A tab that loses its database leaves
 * its whole queue and its generation. A rebuild leaves each waiting row, the
 * generation, the count of the room made, the emptied position and the mark
 * of a session end. Each copy has its own key under one prefix, so no copy
 * writes over another. Only an open that finds a copy, and a rebuild, load
 * this module, so the first screen does not.
 */

type Rescue = {
  readonly generation: unknown;
  readonly room?: number;
  readonly position?: SyncPosition;
  readonly ended?: unknown;
  readonly waiting: ReadonlyArray<unknown>;
};

function isRescue(value: unknown): value is Rescue {
  return (
    typeof value === 'object' && value !== null && Array.isArray(Reflect.get(value, 'waiting'))
  );
}

/** Each copy under `prefix` with its text. A copy that is no JSON, or of another shape, holds nothing. */
function readCopies(prefix: string): Array<{ key: string; text: string; copy?: Rescue }> {
  const keys = Array.from({ length: localStorage.length }, (_, index) => localStorage.key(index));
  return keys.flatMap((key) => {
    const text = key === null ? null : localStorage.getItem(key);
    if (key === null || text === null || (key !== prefix && !key.startsWith(`${prefix}:`))) {
      return [];
    }
    try {
      const copy: unknown = JSON.parse(text);
      return [isRescue(copy) ? { key, text, copy } : { key, text }];
    } catch {
      return [{ key, text }];
    }
  });
}

type Writable = IDBPTransaction<unknown, Array<string>, 'readwrite'>;

/**
 * Writes back one copy: each waiting row that the database does not hold, in
 * order, and the count, position and mark that it lacks. A copy of another
 * generation is the work of a session that ended, so it writes nothing. It
 * returns the generation of the database after it.
 */
async function writeCopy(copy: Rescue, generation: unknown, tx: Writable): Promise<unknown> {
  if (generation !== undefined && copy.generation !== undefined && copy.generation !== generation) {
    return generation;
  }
  const waiting = tx.objectStore('transactions');
  const position = tx.objectStore('position');
  for (const row of copy.waiting) {
    const id: unknown = typeof row === 'object' && row ? Reflect.get(row, 'id') : undefined;
    if (typeof id === 'string' && (await waiting.index('id').getKey(id)) === undefined) {
      await waiting.add(row);
    }
  }
  const values: ReadonlyArray<readonly [string, unknown]> = [
    ['room', copy.room],
    ['position', copy.position],
    ['ended', copy.ended],
  ];
  for (const [key, value] of values) {
    if (value !== undefined && (await position.get(key)) === undefined) {
      await position.put(value, key);
    }
  }
  return generation ?? copy.generation;
}

/**
 * Writes back each copy under `prefix` in one database transaction, and the
 * generation of the first one when the database has none. After the commit
 * it removes each copy that it wrote back and that no tab wrote again. A
 * crash before that writes the copy back once more, and a row that the
 * database holds already, by its transaction ID, is not added again.
 */
export async function writeBack(database: IDBPDatabase, prefix: string): Promise<void> {
  const copies = readCopies(prefix);
  const tx = database.transaction(['transactions', 'position'], 'readwrite');
  const found: unknown = await tx.objectStore('position').get('generation');
  let generation = found;
  for (const { copy } of copies) {
    generation = copy ? await writeCopy(copy, generation, tx) : generation;
  }
  if (generation !== found && generation !== undefined) {
    await tx.objectStore('position').put(generation, 'generation');
  }
  await tx.done;
  for (const { key, text } of copies) {
    if (localStorage.getItem(key) === text) {
      localStorage.removeItem(key);
    }
  }
}

/** What a rebuild of the web local database needs from its handle. */
type Rebuilt = {
  readonly database: IDBPDatabase;
  readonly name: string;
  readonly version: number;
  readonly callbacks: OpenDBCallbacks<unknown>;
  /** The generation that the handle read when it opened. */
  readonly generation: unknown;
  /** The `localStorage` key of the copy of this rebuild. */
  readonly key: string;
  /** Opens the new database as each open does, so it writes back each copy. */
  readonly reopen: (database: IDBPDatabase) => Promise<unknown>;
};

/**
 * Deletes the web local database and creates it again with only what a
 * device must keep. A copy of it waits in `localStorage` until the new rows
 * are written, and an open writes back a copy that is still there. Each
 * other tab lets the old database go before the delete, and leaves a copy of
 * its whole queue, which the open of the new database writes back too.
 * `makeRoom` calls it only when it cannot drop the confirmed records. It
 * gives `cleared` when another handle cleared the database, and else the new
 * database.
 */
export async function rebuild(handle: Rebuilt): Promise<IDBPDatabase | 'cleared'> {
  const tx = handle.database.transaction(['transactions', 'position'], 'readonly');
  const [waiting, saved, ended, current, room] = await Promise.all([
    tx.objectStore('transactions').getAll(),
    tx.objectStore('position').get('position'),
    tx.objectStore('position').get('ended'),
    tx.objectStore('position').get('generation'),
    tx.objectStore('position').get('room'),
    tx.done,
  ]);
  if (current !== handle.generation) {
    return 'cleared';
  }
  const position = emptiedPosition(saved);
  const rescue: Rescue = {
    generation: current,
    room: roomCount(room) + 1,
    ...(position ? { position } : {}),
    ended,
    waiting,
  };
  // With no copy, the delete could lose the waiting rows, so it does not run.
  localStorage.setItem(handle.key, JSON.stringify(rescue));
  handle.database.close();
  await deleteDB(handle.name);
  const database = await openDB(handle.name, handle.version, handle.callbacks);
  await handle.reopen(database);
  return database;
}
