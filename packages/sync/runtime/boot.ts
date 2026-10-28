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
 * The longest wait for the first paint, in milliseconds. A page that loads
 * without a paint, such as a background tab, runs no frame callback until it
 * shows. Without this limit it would not connect, and it would miss live
 * deltas until a person opened it.
 */
const paintWait = 500;

/**
 * Runs `start` once, in the task after the first paint. A page that loads
 * hidden has no paint to wait for, so `start` runs at once. A page that has
 * not painted after `paintWait` starts anyway.
 */
export function afterFirstPaint(start: () => void): void {
  let started = false;
  const once = () => {
    if (!started) {
      started = true;
      start();
    }
  };
  if (document.visibilityState === 'hidden') {
    once();
    return;
  }
  requestAnimationFrame(() => setTimeout(once, 0));
  setTimeout(once, paintWait);
}

/**
 * Starts the sync engine after the first paint. The transport and its Effect
 * code are a separate chunk that loads here, never before the screen shows.
 */
export function connectAfterPaint(
  pool: Pool,
  options: { readonly url: string; readonly onSessionEnded: () => void },
) {
  afterFirstPaint(async () => {
    const { connect } = await import('@repo/sync/runtime/transport');
    connect(pool, options);
  });
}
