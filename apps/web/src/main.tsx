import { connectAfterPaint, loadPool } from '@repo/sync/runtime/boot';
import { openLocalDatabase } from '@repo/sync/runtime/local-database';
import { SyncProvider } from '@repo/sync/ui/sync-provider';
import { RouterProvider } from '@tanstack/react-router';
import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';

import { commands } from '@/commands';
import { router } from '@/router';
import { registerServiceWorker } from '@/service-worker';

import '@/styles.css';

/**
 * The composition root of the web app. It loads the object pool from the
 * local database, renders, and only then starts the sync engine.
 */
const database = await openLocalDatabase('web');
const pool = await loadPool(database, commands);
const root = document.querySelector('#root');
if (root) {
  createRoot(root).render(
    <StrictMode>
      <SyncProvider pool={pool}>
        <RouterProvider router={router} />
      </SyncProvider>
    </StrictMode>,
  );
}
const socket = new URL('/sync', location.href);
socket.protocol = socket.protocol === 'https:' ? 'wss:' : 'ws:';
registerServiceWorker();
connectAfterPaint(pool, {
  url: socket.href,
  onSessionEnded: async () => {
    await database.clear();
    location.assign('/');
  },
});
