import { createPool } from '@repo/sync/runtime/pool';
import type { Pool } from '@repo/sync/runtime/pool';
import type { LocalDatabase } from '@repo/sync/types/local-database';
import type { Command } from '@repo/sync/types/records';

/**
 * Loads the object pool from the local database before the first paint. Each
 * change to the pool is written back. This file imports no Effect code, so
 * the first screen stays small.
 */
export async function loadPool(
  database: LocalDatabase,
  commands: ReadonlyArray<Command<never>>,
): Promise<Pool> {
  const pool = createPool(commands);
  const state = await database.read();
  if (state) {
    pool.load(state);
  }
  // One write at a time, and always the newest state.
  let writing = false;
  let again = false;
  async function save() {
    if (writing) {
      again = true;
      return;
    }
    writing = true;
    do {
      again = false;
      await database.write(pool.snapshot());
    } while (again);
    writing = false;
  }
  pool.subscribe(() => {
    void save();
  });
  return pool;
}

/**
 * Starts the sync engine after the first paint. The transport and its Effect
 * code are a separate chunk that loads here, never before the screen shows.
 */
export function connectAfterPaint(
  pool: Pool,
  options: { readonly url: string; readonly onSessionEnded: () => void },
) {
  requestAnimationFrame(() => {
    setTimeout(async () => {
      const { connect } = await import('@repo/sync/runtime/transport');
      connect(pool, options);
    }, 0);
  });
}
