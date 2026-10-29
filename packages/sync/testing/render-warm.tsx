import { createPool } from '@repo/sync/runtime/pool';
import type { Pool } from '@repo/sync/runtime/pool';
import type { PoolState } from '@repo/sync/types/local-database';
import type { Replayable } from '@repo/sync/types/records';
import { SyncProvider } from '@repo/sync/ui/sync-provider';
import type { ReactElement } from 'react';
import { renderToString } from 'react-dom/server';

const networkGlobals = ['fetch', 'WebSocket', 'XMLHttpRequest', 'EventSource'] as const;

/**
 * Renders a screen with a warm object pool and fails on any network call. A
 * screen that shows data the device has must paint with no request. See
 * docs/principles/local-first.md.
 */
export function renderWarm(
  screen: (pool: Pool) => ReactElement,
  state: PoolState,
  commands: ReadonlyArray<Replayable> = [],
): string {
  const pool = createPool(commands);
  pool.load(state);
  const calls: Array<string> = [];
  const saved = networkGlobals.map((name) => [name, Reflect.get(globalThis, name)] as const);
  for (const name of networkGlobals) {
    Reflect.set(globalThis, name, () => {
      calls.push(name);
      throw new Error(`${name} ran during a warm render.`);
    });
  }
  try {
    const html = renderToString(<SyncProvider pool={pool}>{screen(pool)}</SyncProvider>);
    if (calls.length) {
      throw new Error(
        `A warm screen made network calls: ${calls.join(', ')}. Read the object pool instead.`,
      );
    }
    return html;
  } finally {
    for (const [name, value] of saved) {
      Reflect.set(globalThis, name, value);
    }
  }
}
