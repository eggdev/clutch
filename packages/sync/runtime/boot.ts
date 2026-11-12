import type { Replayable } from '@repo/sync/contract/command';
import type { Contract } from '@repo/sync/contract/define';
import type { Stamps } from '@repo/sync/contract/fields';
import { createPool } from '@repo/sync/runtime/pool';
import type { Pool } from '@repo/sync/runtime/pool';
import type { Report } from '@repo/sync/runtime/pool-doors';
import type { LocalDatabase } from '@repo/sync/types/local-database';

/** The commands of the contracts that show at once and have no local change in `changes`. */
function withoutLocalChange(
  contracts: ReadonlyArray<Contract>,
  changes: ReadonlyArray<Replayable>,
): Array<string> {
  const known = new Set(changes.map((change) => change.name));
  return contracts
    .flatMap((contract) => contract.commands)
    .filter((declared) => declared.waits === 'local' && !known.has(declared.name))
    .map((declared) => declared.name);
}

/**
 * Loads the object pool from the local database before the first paint. Each
 * change to the pool is written back. This file imports no Effect code, so
 * the first screen stays small.
 *
 * `contracts` lists each contract of the app. A command of one of them that
 * shows at once and has no local change in `changes` stops the app here, at
 * its start, so no screen runs a command that would show nothing.
 *
 * `stamps` is where a new ID and the time come from on this platform. The
 * web leaves it out and gets `crypto.randomUUID` and the device clock. A
 * native app fills the global `crypto` of Hermes before it loads, and leaves
 * it out too.
 *
 * `report` receives each sentence about a saved copy that does not fit this
 * build. The web leaves it out and gets the console.
 */
export async function loadPool(
  database: LocalDatabase,
  changes: ReadonlyArray<Replayable>,
  contracts: ReadonlyArray<Contract>,
  stamps?: Stamps,
  report?: Report,
): Promise<Pool> {
  const missing = withoutLocalChange(contracts, changes);
  if (missing.length) {
    throw new Error(
      `The app gives the object pool no local change for: ${missing.join(', ')}. Add the local changes of each contract to its \`commands\` list.`,
    );
  }
  const pool = createPool(
    changes,
    {
      records: contracts.flatMap((contract) => contract.records),
      commands: contracts.flatMap((contract) => contract.commands),
    },
    { stamps, report },
  );
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
  pool.onChange(() => {
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
 * not painted after `paintWait` starts anyway. A native app has no document,
 * and it waits for its first frame the same way.
 */
export function afterFirstPaint(start: () => void): void {
  let started = false;
  const once = () => {
    if (!started) {
      started = true;
      start();
    }
  };
  if (typeof document !== 'undefined' && document.visibilityState === 'hidden') {
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
  options: {
    readonly url: string;
    readonly onSessionEnded: () => void;
    /** The contracts of the app. Their digest names this build to the server. */
    readonly contracts: ReadonlyArray<Contract>;
    /** The headers of the socket. Only a native app can send them. */
    readonly headers?: Readonly<Record<string, string>>;
  },
) {
  afterFirstPaint(async () => {
    const { connect } = await import('@repo/sync/runtime/transport');
    connect(pool, options);
  });
}
