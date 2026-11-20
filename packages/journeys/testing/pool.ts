import { expect } from '@playwright/test';
import type { Page } from '@playwright/test';
import type { RecordRow } from '@repo/sync/contract/record';
import type { SavedRecord } from '@repo/sync/types/local-database';
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

/** The rows of the pool: one for each confirmed record, and one for each transaction without an answer. */
export type PoolState = {
  readonly records: ReadonlyArray<SavedRecord>;
  readonly pending: ReadonlyArray<PoolPending>;
};

/**
 * What the page's IndexedDB holds in the stores `records` and `transactions`,
 * or `undefined` when no database has those stores yet. The journey does not
 * know the name that the app gave its database: it reads the one database
 * that has the stores. Each database it opens exists already, so no open
 * creates one or blocks the app's own upgrade. Two databases with the stores
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
      if (db.objectStoreNames.contains('records') && db.objectStoreNames.contains('transactions')) {
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
        `${found.length} databases of this page have the stores of the pool: ${names}. The journey reads one.`,
      );
    }
    const tx = db.transaction(['records', 'transactions'], 'readonly');
    const all = (store: string) =>
      new Promise<Array<unknown>>((resolve, reject) => {
        const get = tx.objectStore(store).getAll();
        get.addEventListener('success', () => resolve(get.result));
        get.addEventListener('error', () => reject(get.error));
      });
    const [rows, pending] = await Promise.all([all('records'), all('transactions')]);
    db.close();
    return { records: rows, pending } as PoolState;
  });
  return state.then((value) => value ?? undefined);
}

/** The records of one model in the pool, such as `Note`, or none when the pool has none of them. */
export async function records(page: Page, model: string): Promise<ReadonlyArray<PoolRow>> {
  const state = await poolState(page);
  return state?.records.filter((record) => record.model === model).map(({ row }) => row) ?? [];
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
