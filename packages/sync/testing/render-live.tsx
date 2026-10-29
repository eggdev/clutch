import { GlobalRegistrator } from '@happy-dom/global-registrator';
import { createPool } from '@repo/sync/runtime/pool';
import type { Pool } from '@repo/sync/runtime/pool';
import type { PoolState } from '@repo/sync/types/local-database';
import type { Replayable } from '@repo/sync/types/records';
import { SyncProvider } from '@repo/sync/ui/sync-provider';
import { act } from 'react';
import type { ReactElement } from 'react';
import { createRoot } from 'react-dom/client';

type Live = {
  readonly pool: Pool;
  readonly container: HTMLElement;
  /** Runs a change inside `act`, so React finishes every update before the next line. */
  readonly change: (work: () => void) => Promise<void>;
  readonly unmount: () => Promise<void>;
};

/**
 * Renders a screen in a DOM with a live object pool, so a test can change the
 * pool and read what the screen shows. Call `unmount` at the end of the test.
 */
export async function renderLive(
  screen: () => ReactElement,
  state: PoolState,
  commands: ReadonlyArray<Replayable> = [],
): Promise<Live> {
  if (!GlobalRegistrator.isRegistered) {
    GlobalRegistrator.register();
  }
  Reflect.set(globalThis, 'IS_REACT_ACT_ENVIRONMENT', true);
  const pool = createPool(commands);
  pool.load(state);
  const container = document.createElement('div');
  document.body.append(container);
  const root = createRoot(container);
  await act(() => {
    root.render(<SyncProvider pool={pool}>{screen()}</SyncProvider>);
  });
  return {
    pool,
    container,
    async change(work) {
      await act(() => {
        work();
        return Promise.resolve();
      });
    },
    async unmount() {
      await act(() => {
        root.unmount();
      });
      await GlobalRegistrator.unregister();
    },
  };
}
