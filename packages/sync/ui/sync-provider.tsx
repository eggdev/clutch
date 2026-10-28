import type { Pool } from '@repo/sync/runtime/pool';
import type { Command, Model, ReadablePool, RecordRow } from '@repo/sync/types/records';
import { createContext, use, useSyncExternalStore } from 'react';
import type { ReactNode } from 'react';

type Sync = {
  readonly pool: ReadablePool;
  readonly run: Pool['run'];
  readonly isPending: Pool['isPending'];
};

const SyncContext = createContext<Sync | null>(null);

/** Gives screens read access to the object pool, and a way to run commands. */
export function SyncProvider({
  pool,
  children,
}: {
  readonly pool: Pool;
  readonly children: ReactNode;
}) {
  return (
    <SyncContext value={{ pool, run: pool.run, isPending: pool.isPending }}>{children}</SyncContext>
  );
}

function useSync(): Sync {
  const sync = use(SyncContext);
  if (!sync) {
    throw new Error('SyncProvider is missing. The app wraps its routes in SyncProvider.');
  }
  return sync;
}

/**
 * Every record of one model, as the pool holds it now. The pool returns the
 * same array until it changes, so the snapshot is stable, and React Compiler
 * cannot keep a stale list.
 */
export function useRecords<Row extends RecordRow>(model: Model<Row>): ReadonlyArray<Row> {
  const { pool } = useSync();
  const read = () => pool.all(model);
  return useSyncExternalStore(pool.subscribe, read, read);
}

/** Runs a command: the local change shows at once, and the sync engine sends it. */
export function useCommand<Input>(command: Command<Input>): (input: Input) => string {
  const { run } = useSync();
  return (input) => run(command, input);
}

/** The reason for the last rejected transaction, for the screen to show. */
export function useLastRejection() {
  const { pool } = useSync();
  return useSyncExternalStore(pool.subscribe, pool.lastRejection, pool.lastRejection);
}
