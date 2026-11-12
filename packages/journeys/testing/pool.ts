import { expect } from '@playwright/test';
import type { Page } from '@playwright/test';
import type { RecordRow } from '@repo/sync/contract/record';
import type { PoolState as SyncPoolState } from '@repo/sync/types/local-database';
import type { Transaction } from '@repo/sync/types/protocol';

/**
 * Reads the object pool of a web page, as the app keeps it in IndexedDB. The
 * app writes the pool after each change, so a journey reads what the device
 * holds without a new code path in the app. The types are the sync package's
 * own types, imported as types only, so a change to the pool shows here at
 * compile time. See docs/contributing/end-to-end-testing.md#agent-and-pool.
 */

/** One record of the pool, as the server sent it. */
export type PoolRow = RecordRow;

/** A transaction that the page ran and that the server has not answered yet. */
export type PoolPending = Transaction;

/** The state of the pool: the records by model, the groups loaded and the transactions without an answer. */
export type PoolState = SyncPoolState;

/**
 * What the page's IndexedDB holds under the store `pool` and the key `state`,
 * or `undefined` when no database has that store yet. The journey does not
 * know the name that the app gave its database: it reads the one database
 * that has the store. Each database it opens exists already, so no open
 * creates one or blocks the app's own upgrade. Two databases with the store
 * are an error, because the journey cannot tell which one the app reads.
 */
export function poolState(page: Page): Promise<PoolState | undefined> {
  const state = page.evaluate(async () => {
    const found: Array<IDBDatabase> = [];
    for (const { name } of await indexedDB.databases()) {
      if (name === undefined) {
        continue;
      }
      const request = indexedDB.open(name);
      const db = await new Promise<IDBDatabase>((resolve, reject) => {
        request.addEventListener('success', () => resolve(request.result));
        request.addEventListener('error', () => reject(request.error));
      });
      if (db.objectStoreNames.contains('pool')) {
        found.push(db);
      } else {
        db.close();
      }
    }
    const [db, ...others] = found;
    if (db === undefined) {
      return null;
    }
    if (others.length > 0) {
      const names = found.map((item) => item.name).join(', ');
      for (const item of found) {
        item.close();
      }
      throw new Error(
        `${found.length} databases of this page have a \`pool\` store: ${names}. The journey reads one.`,
      );
    }
    return new Promise<PoolState | null>((resolve, reject) => {
      const get = db.transaction('pool', 'readonly').objectStore('pool').get('state');
      get.addEventListener('success', () => {
        db.close();
        resolve((get.result as PoolState | undefined) ?? null);
      });
      get.addEventListener('error', () => reject(get.error));
    });
  });
  return state.then((value) => value ?? undefined);
}

/** The records of one model in the pool, such as `Note`, or none when the pool has none of them. */
export async function records(page: Page, model: string): Promise<ReadonlyArray<PoolRow>> {
  const state = await poolState(page);
  return state?.tables[model] ?? [];
}

/** The commands that the page has sent and the server has not answered yet, by name. */
async function pendingCommands(page: Page): Promise<Array<string>> {
  const state = await poolState(page);
  if (state === undefined) {
    return ['the pool has no state yet'];
  }
  return state.pending.map((item) => item.command);
}

/**
 * Waits until every command that the page ran has its answer from the server,
 * which is an empty `pending` list. A failure shows the commands still pending.
 */
export async function settled(page: Page): Promise<void> {
  await expect
    .poll(() => pendingCommands(page), {
      message: 'The commands below still wait for the server. Each one must get its answer.',
      timeout: 15_000,
    })
    .toEqual([]);
}
