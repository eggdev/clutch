import type { Replayable } from '@repo/sync/contract/command';
import { withoutLocalChange } from '@repo/sync/contract/define';
import type { Contract } from '@repo/sync/contract/define';
import type { Stamps } from '@repo/sync/contract/fields';
import { createPool } from '@repo/sync/runtime/pool';
import type { Pool } from '@repo/sync/runtime/pool';
import { consoleReport } from '@repo/sync/runtime/pool-doors';
import type { Report } from '@repo/sync/runtime/pool-doors';
import type { LocalDatabase, WaitingRow } from '@repo/sync/types/local-database';

/** The actor of a waiting row as one string, empty for a row with no actor. */
const actorOf = ({ actor }: WaitingRow) =>
  actor ? `${actor.userId}\u0000${actor.organizationId}` : '';

/**
 * The waiting transactions to add and to delete: each one in the queue that
 * the database does not hold for this tab, or holds with another actor, such
 * as a row that took the confirmed actor, and each one that this tab holds
 * and that left its queue. `held` maps each row of this tab to its actor.
 */
function queueChanges(
  queue: ReadonlyArray<WaitingRow>,
  held: ReadonlyMap<string, string>,
): { readonly add: ReadonlyArray<WaitingRow>; readonly done: ReadonlyArray<string> } {
  const queued = new Set(queue.map(({ id }) => id));
  return {
    add: queue.filter((row) => held.get(row.id) !== actorOf(row)),
    done: [...held.keys()].filter((id) => !queued.has(id)),
  };
}

/** The first wait after a failed save, in milliseconds. Each wait after it is twice as long. */
const firstWait = 200;
/** The longest wait between two saves that fail, in milliseconds. */
const longestWait = 10_000;
/** The saves that fail in a row before the pool makes room, also with no sign of a full device. */
const failuresBeforeRoom = 3;

const couldNotSave =
  'This device could not save the last change. The change stays on this screen, and the next change saves again.';
const madeRoom =
  'This device could not save, so the app removed its saved copy of the server data to make room, and nothing you did is lost.';

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}

/**
 * Whether a failed save says that the device is full. IndexedDB names the
 * error `QuotaExceededError`, and SQLite says it in its message.
 */
function isQuotaError(error: unknown): boolean {
  if (typeof error !== 'object' || error === null) {
    return false;
  }
  const message: unknown = Reflect.get(error, 'message');
  return (
    Reflect.get(error, 'name') === 'QuotaExceededError' ||
    (typeof message === 'string' && /SQLITE_FULL|disk is full/iu.test(message))
  );
}

/** The object pool of the app, and the stop of its saves. */
export type SavedPool = Pool & {
  /**
   * Stops the saves of this pool. It detaches the save listener and waits
   * for a save that runs. After it, no change of this pool reaches the local
   * database. A session end calls it before it clears the database.
   */
  readonly stop: () => Promise<void>;
};

/**
 * Loads the object pool from the local database before the first paint. Each
 * change to the pool is written back: the records that changed and the sync
 * position, and the waiting transactions that this tab added or finished.
 * Only the tab that the database names as the writer writes the confirmed
 * records. This file imports no Effect code, so the first screen stays small.
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
 * build, and about a change that the device could not save. The web leaves it
 * out and gets the console.
 *
 * `wait` is how a save waits after a failure. The app leaves it out and gets
 * a timer. A test passes waits that it ends itself.
 *
 * The waiting transactions are what a device must never lose, and the
 * confirmed records are a cache of the server. So a save that fails with a
 * full device, or `failuresBeforeRoom` saves that fail in a row, make room:
 * the database drops its confirmed records and keeps the waiting ones.
 */
export async function loadPool(
  database: LocalDatabase,
  changes: ReadonlyArray<Replayable>,
  contracts: ReadonlyArray<Contract>,
  stamps?: Stamps,
  report?: Report,
  wait?: (ms: number) => Promise<void>,
): Promise<SavedPool> {
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
  // A tab that writes before its read reads the newest saved state, so it
  // writes only what changes after it. A tab that becomes the writer later
  // writes its whole confirmed state once.
  let writer = database.isWriter();
  const state = await database.read();
  if (state) {
    pool.load(state);
  }
  // The waiting transactions of this tab in the database: each one that it
  // loaded, and each one that it added since. A tab deletes only these.
  let held = new Map(state?.pending.map((row) => [row.id, actorOf(row)]));
  // One save at a time, and always the newest state. A save that fails is
  // reported once, and the next attempt waits, longer each time, then saves
  // every record. A device that is full, or that keeps failing, makes room:
  // see `makeRoom`.
  const tell = report ?? consoleReport;
  const pause = wait ?? sleep;
  let writing = false;
  let again = false;
  let failures = 0;
  let waits = 0;
  let roomMade = false;
  let everything = false;
  let stopped = false;
  // The load dropped what a fresh mark of a session end asked for. The first
  // save spends the mark, so no later start drops a row again.
  let afterLoad = true;
  let running: Promise<void> = Promise.resolve();
  const stopping = Promise.withResolvers<null>();

  /**
   * Gives up the confirmed records on the device, which are a cache of the
   * server, so the waiting transactions fit. For the rest of this session
   * the pool saves only its waiting transactions, so it cannot fill the
   * device again. The records in memory stay. The next start loads again
   * from the server. It returns whether the pool saves again at once.
   */
  async function makeRoom(): Promise<boolean> {
    try {
      if ((await database.makeRoom()) === 'cleared') {
        stopped = true;
        return false;
      }
    } catch {
      // The next failure tries again.
      return false;
    }
    roomMade = true;
    tell(madeRoom);
    return true;
  }

  /**
   * Follows a failed save: it reports the first failure of a run, makes room
   * when the device is full or keeps failing, and else waits, twice as long
   * each time, up to `longestWait`. A change while it waits saves with the
   * next attempt, and a stop ends the wait. It returns whether to save again.
   */
  async function afterFailure(failure: unknown): Promise<boolean> {
    // A save that fails after a stop, such as on a database that is lost, does nothing more.
    if (stopped) {
      return false;
    }
    everything = true;
    failures += 1;
    if (failures === 1) {
      tell(couldNotSave);
    }
    const full = isQuotaError(failure) || failures >= failuresBeforeRoom;
    if (!roomMade && full && (await makeRoom())) {
      return true;
    }
    if (stopped) {
      return false;
    }
    await Promise.race([pause(Math.min(firstWait * 2 ** waits, longestWait)), stopping.promise]);
    waits += 1;
    return !stopped;
  }

  async function saveAll() {
    try {
      do {
        // A save that waits behind the running one never starts after a stop.
        if (stopped) {
          break;
        }
        again = false;
        const confirmed = writer && !roomMade ? pool.confirmedChanges(everything) : undefined;
        everything &&= !confirmed;
        const { add, done } = queueChanges(pool.queue(), held);
        const startSave = afterLoad;
        if (!confirmed && !startSave && add.length === 0 && done.length === 0) {
          continue;
        }
        try {
          const result = await database.save({
            ...(confirmed ? { confirmed } : {}),
            add,
            done,
            ...(startSave ? { afterLoad: true } : {}),
          });
          if (result === 'cleared') {
            // Another tab ended the session after this one opened. This pool
            // never saves again, and the database wakes `onLost`, so the app
            // starts again.
            stopped = true;
            break;
          }
          afterLoad = false;
          held = new Map([...held, ...add.map((row): [string, string] => [row.id, actorOf(row)])]);
          for (const id of done) {
            held.delete(id);
          }
          failures = 0;
          waits = 0;
        } catch (error) {
          again = await afterFailure(error);
        }
      } while (again);
    } finally {
      // Also when `report` throws, so no failure stops the saves that follow.
      writing = false;
    }
  }
  function save(): Promise<void> {
    if (stopped) {
      return running;
    }
    // A change while a save runs or waits saves with it.
    if (writing) {
      again = true;
      return running;
    }
    writing = true;
    running = saveAll();
    return running;
  }
  void (async () => {
    await database.writer;
    if (!writer) {
      writer = true;
      everything = true;
      await save();
    }
  })();
  const detach = pool.onChange(() => {
    void save();
  });
  // The first save removes what the load dropped, such as a saved command that this build refused.
  void save();
  return Object.assign(pool, {
    stop: async () => {
      stopped = true;
      stopping.resolve(null);
      detach();
      // A save that fails still ends the stop, so the session end goes on.
      await Promise.allSettled([running]);
    },
  });
}

/**
 * Ends the session on this device, with no server: it stops the sync engine
 * with `disconnect`, stops the saves of the pool, then clears the local
 * database. A sign-out calls it, also offline, and so does the app when the
 * server ends the session. Then the app starts again with an empty pool.
 */
export async function endSession(
  database: LocalDatabase,
  pool: SavedPool,
  disconnect: () => void,
): Promise<void> {
  disconnect();
  await pool.stop();
  await database.clear();
}

/**
 * Follows the loss of the local database in this tab. Another tab ended the
 * session and cleared the database: the tab hears it as a message, or as a
 * save that found the database cleared, whichever comes first. Or a tab of a
 * newer build took the database for its new layout, or another tab deletes
 * it to make room. This tab then keeps its whole queue of waiting
 * transactions with `keep`, also each one whose save had not started or
 * waits after a failure. It stops its engine with `disconnect` and the saves
 * of its pool at once, before it can write anything back, keeps its queue
 * again with what ran since, and calls `restart`. So the app starts again on
 * what the database holds now, with each waiting transaction. The adapter
 * writes back no row of a session that a clear ended. The tab that clears
 * never hears its own clear. It follows one loss, and returns the stop of the
 * follow.
 */
export function followLostDatabase(
  database: LocalDatabase,
  pool: SavedPool,
  disconnect: () => void,
  restart: () => void,
): () => void {
  const stop = database.onLost(() => {
    // One end is enough: the start that follows has its own follow.
    stop();
    database.keep(pool.queue());
    disconnect();
    void (async () => {
      await pool.stop();
      database.keep(pool.queue());
      restart();
    })();
  });
  return stop;
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
 * It returns the stop of the engine. A stop before the engine starts keeps
 * it from starting.
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
): () => void {
  let stopped = false;
  let stopEngine: (() => void) | undefined;
  afterFirstPaint(async () => {
    const { connect } = await import('@repo/sync/runtime/transport');
    if (!stopped) {
      stopEngine = connect(pool, options);
    }
  });
  return () => {
    stopped = true;
    stopEngine?.();
  };
}
