import type { Rescue } from '@repo/sync/runtime/indexed-db';
import { emptiedPosition, roomCount } from '@repo/sync/runtime/pool-doors';
import { deleteDB, openDB } from 'idb';
import type { IDBPDatabase, OpenDBCallbacks } from 'idb';

/** What a rebuild of the web local database needs from its handle. */
type Rebuilt = {
  readonly database: IDBPDatabase;
  readonly name: string;
  readonly version: number;
  readonly callbacks: OpenDBCallbacks<unknown>;
  /** The generation that the handle read when it opened. */
  readonly generation: unknown;
  /** The `localStorage` key of the copy of this handle. */
  readonly key: string;
  /** Opens the new database: it writes back each copy, and removes the copies that it wrote. */
  readonly reopen: (database: IDBPDatabase) => Promise<unknown>;
};

/**
 * Deletes the web local database and creates it again with only what a
 * device must keep: each waiting row, the generation, the count of the room
 * made, the emptied position and the mark of a session end. A copy waits in
 * `localStorage` until the new rows are written, and an open writes back a
 * copy that is still there. `makeRoom` loads this module only when it cannot
 * drop the confirmed records, so the first screen does not load it. It gives
 * `cleared` when another handle cleared the database, and else the new
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
  const rescue: Rescue = {
    generation: current,
    room: roomCount(room) + 1,
    position: emptiedPosition(saved),
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
