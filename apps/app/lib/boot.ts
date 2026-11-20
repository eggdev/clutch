import { clientOf } from '@repo/sync/contract/define';
import {
  connectAfterPaint,
  endSession,
  followLostDatabase,
  loadPool,
} from '@repo/sync/runtime/boot';
import { openLocalDatabase } from '@repo/sync/runtime/local-database';
import type { Pool } from '@repo/sync/runtime/pool';
import { useSyncExternalStore } from 'react';

import { bootStore } from '@/lib/boot-store';
import type { BootState } from '@/lib/boot-store';
import { packages } from '@/lib/packages';
import { afterSessionEnded, socketHeaders, syncUrl } from '@/lib/server';
import { registerServiceWorker } from '@/lib/service-worker';

/**
 * The composition root of the app, on each platform. It loads the object pool
 * from the local database, then the layout renders, and only then the sync
 * engine starts. The list in `lib/packages.ts` is the one place that names
 * the packages of the app: the contracts and the commands come from it.
 */
const { contracts, commands } = clientOf(packages);

/** The end of the session of the current start, once it has loaded. */
let endCurrent: (() => Promise<void>) | undefined;

function engineNotStarted() {
  // The start below connects the engine before anything can end it.
}

/**
 * One start of the app. The pool reports a saved copy, a record from the
 * server or a command that does not fit this build. Each report goes to the
 * console for a developer and to the store for the person, so a build that is
 * older than its data is never quiet. A start that throws becomes a failure
 * that the layout shows.
 */
const store = bootStore<Pool>(async (report) => {
  const database = await openLocalDatabase('app');
  const pool = await loadPool(database, commands, contracts, undefined, (line) => {
    console.error(line);
    report(line);
  });
  registerServiceWorker();
  let ended = false;
  let disconnect = engineNotStarted;
  // A session end in another tab stops this one too, and it starts again. So
  // does a tab of a newer build that takes the local database for its new
  // layout: the page loads again, with the newer build.
  const unfollow = followLostDatabase(
    database,
    pool,
    () => {
      ended = true;
      disconnect();
    },
    () => {
      store.restart();
      afterSessionEnded();
    },
  );
  const end = async () => {
    // A second end of the same start, such as a sign-out and a 4401 close, does nothing.
    if (ended) {
      return;
    }
    ended = true;
    unfollow();
    await endSession(database, pool, disconnect);
    store.restart();
    afterSessionEnded();
  };
  disconnect = connectAfterPaint(pool, {
    url: syncUrl(),
    contracts,
    headers: socketHeaders(),
    onSessionEnded: () => {
      void end();
    },
  });
  endCurrent = end;
  return pool;
});

/**
 * Ends the session on this device: it stops the sync engine and the saves
 * of the pool, clears the local database, and starts the app again with an
 * empty pool. It needs no server, so a sign-out that happens offline still
 * clears the device. The app calls it when the server ends the session. A
 * project's sign-out screen calls it after its identity vendor signs out.
 */
export async function endSessionOnDevice(): Promise<void> {
  await endCurrent?.();
}

/**
 * The start of the app: the object pool once the app has read the local
 * database, the failure of a start that threw, and each report of the pool.
 * The layout shows no route before it has the pool, so the first frame of a
 * screen is its data. The build renders each page with the first state: it
 * never subscribes, so it reads no device.
 */
export function useBoot(): BootState<Pool> {
  return useSyncExternalStore(store.subscribe, store.state, store.state);
}

/** Starts the app again, after a start that failed. */
export function retryBoot(): void {
  store.restart();
}
