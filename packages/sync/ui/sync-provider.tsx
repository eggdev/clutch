import type { Pool } from '@repo/sync/runtime/pool';
import type {
  Command,
  Load,
  Model,
  Order,
  ReadablePool,
  RecordRow,
  Where,
} from '@repo/sync/types/records';
import { createContext, use, useSyncExternalStore } from 'react';
import type { ReactNode } from 'react';

/** What screens see of the pool: reads, `run` for commands and group loads. No other write. */
type Sync = ReadablePool & Pick<Pool, 'run' | 'isPending' | 'loadGroup'>;

const SyncContext = createContext<Sync | null>(null);

/** Gives screens read access to the object pool, and a way to run commands. */
export function SyncProvider({
  pool,
  children,
}: {
  readonly pool: Pool;
  readonly children: ReactNode;
}) {
  return <SyncContext value={pool}>{children}</SyncContext>;
}

function useSync(): Sync {
  const sync = use(SyncContext);
  if (!sync) {
    throw new Error('SyncProvider is missing. The app wraps its routes in SyncProvider.');
  }
  return sync;
}

/**
 * The IDs of a model's records, for a list. The component re-renders only
 * when a record is added or removed, or when the order changes. A change to a
 * field that does not move a record leaves the list alone: each row reads its
 * own record with `useRecord`.
 */
export function useRecordIds<Row extends RecordRow>(
  model: Model<Row>,
  order?: Order<Row>,
  where?: Where<Row>,
): ReadonlyArray<string> {
  const pool = useSync();
  const read = () => pool.ids(model, order, where);
  return useSyncExternalStore((listener) => pool.watchModel(model, listener), read, read);
}

/**
 * One record, for the component that shows it. The component re-renders only
 * when this record changes. `undefined` means the record is gone.
 */
export function useRecord<Row extends RecordRow>(model: Model<Row>, id: string): Row | undefined {
  const pool = useSync();
  const read = () => pool.get(model, id);
  return useSyncExternalStore((listener) => pool.watchRecord(model, id, listener), read, read);
}

/** Runs a command: the local change shows at once, and the sync engine sends it. */
export function useCommand<Input>(command: Command<Input>): (input: Input) => string {
  const { run } = useSync();
  return (input) => run(command, input);
}

/** The reason for the last rejected transaction, for the screen to show. */
export function useLastRejection() {
  const pool = useSync();
  return useSyncExternalStore(pool.watchRejection, pool.lastRejection, pool.lastRejection);
}

/** How long a gate waits for a group before it opens the screen with what the pool has. */
const loadWait = 3000;

/**
 * The loader that a gate calls before it navigates. It asks the sync engine
 * for the group of a load function and waits until its records are in the
 * pool. Offline, or past `loadWait`, it stops waiting and reports `false`, so
 * the gate still opens the screen.
 */
export function useLoad(): <Args extends ReadonlyArray<unknown>>(
  load: Load<Args>,
  ...args: Args
) => Promise<boolean> {
  const { loadGroup } = useSync();
  return (load, ...args) => {
    const loaded = (async () => {
      await loadGroup(load.group(...args));
      return true;
    })();
    const timedOut = new Promise<boolean>((resolve) => {
      setTimeout(() => resolve(false), loadWait);
    });
    return Promise.race([loaded, timedOut]);
  };
}
