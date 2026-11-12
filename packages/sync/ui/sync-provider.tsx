import { builtInRefusals } from '@repo/sync/contract/command';
import type { BuiltInRefusal, Waits } from '@repo/sync/contract/command';
import type { CallOf, Fields } from '@repo/sync/contract/fields';
import type { Load, Model, RecordRow } from '@repo/sync/contract/record';
import type { Pool } from '@repo/sync/runtime/pool';
import type { Order, ReadablePool, Where } from '@repo/sync/types/records';
import { createContext, use, useState, useSyncExternalStore } from 'react';
import type { ReactNode } from 'react';

/** What screens see of the pool: reads, `run` for commands and group loads. No other write. */
type Sync = ReadablePool & Pick<Pool, 'run' | 'isPending' | 'loadGroup' | 'onPending' | 'onChange'>;

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

/** What the hooks need of a command declaration: its name, the fields of its input and whether it waits. */
type Runnable<F extends Fields> = {
  readonly name: string;
  readonly input: F;
  readonly waits: Waits;
};

/**
 * Runs a command: the local change shows at once, and the sync engine sends
 * it. The object pool fills each stamp of the input, so a screen passes no ID
 * and no time.
 */
export function useCommand<F extends Fields>(command: Runnable<F>): (input: CallOf<F>) => string {
  const { run } = useSync();
  return (input) => run(command, input);
}

/**
 * Whether a transaction still waits for the server. The component re-renders
 * only when this transaction starts or stops waiting. No ID reads as
 * not waiting. A transaction stops waiting when its delta arrives or the
 * server rejects it.
 */
export function usePending(transactionId?: string): boolean {
  const pool = useSync();
  const read = () => transactionId !== undefined && pool.isPending(transactionId);
  return useSyncExternalStore(
    (listener) => {
      const stopNew = pool.onPending(listener);
      const stopChange = pool.onChange(listener);
      return () => {
        stopNew();
        stopChange();
      };
    },
    read,
    read,
  );
}

/**
 * The code of a refusal from the wire, as this build knows it. A newer server
 * can refuse with a code that this build does not declare. That reads as
 * `failed`, and the reason still tells the person what happened.
 */
function knownCode<Refusal extends string>(
  declared: ReadonlyArray<Refusal>,
  code: string,
): Refusal | BuiltInRefusal {
  return (
    declared.find((known) => known === code) ??
    builtInRefusals.find((known) => known === code) ??
    'failed'
  );
}

/** Why the server refused a run: a code that the command declares, or a built-in one, and the reason. */
type Refused<Refusal extends string> = {
  readonly code: Refusal | BuiltInRefusal;
  readonly reason: string;
};

/**
 * Runs a command and reports on its last run: whether it still waits, and the
 * refusal if the server refused it. Use it for a command with `waits:
 * 'server'`, so the control that sent it shows a pending state while the rest
 * of the screen stays live. `refused.code` is typed from the `refuses` of the
 * command, so a branch on a code that the command does not declare fails to
 * compile.
 */
export function usePendingCommand<F extends Fields, const Refusal extends string>(
  command: Runnable<F> & { readonly refuses: ReadonlyArray<Refusal> },
): {
  readonly run: (input: CallOf<F>) => string;
  readonly pending: boolean;
  readonly refused: Refused<Refusal> | undefined;
} {
  const pool = useSync();
  const { run } = pool;
  const [last, setLast] = useState<string>();
  const pending = usePending(last);
  // Only the rejection of this control's own run, so another control's
  // rejection does not re-render this one.
  const read = () => {
    const rejection = pool.lastRejection();
    return rejection?.transactionId === last ? rejection : undefined;
  };
  const mine = useSyncExternalStore(pool.watchRejection, read, read);
  return {
    pending,
    refused: mine
      ? { code: knownCode(command.refuses, mine.code), reason: mine.reason }
      : undefined,
    run: (input) => {
      const id = run(command, input);
      setLast(id);
      return id;
    },
  };
}

/**
 * The last rejected transaction of the whole pool, with its code and reason,
 * for a screen-level message.
 */
export function useLastRejection() {
  const pool = useSync();
  return useSyncExternalStore(pool.watchRejection, pool.lastRejection, pool.lastRejection);
}

/** How long a gate waits for a group before it opens the screen with what the pool has. */
const loadWait = 3000;

/**
 * The loader that a gate calls before it navigates. It asks the sync engine
 * for the group of a load function and waits until its records are in the
 * pool. Offline, past `loadWait`, or when the server refuses the group, it
 * stops waiting and reports `false`, so the gate still opens the screen.
 */
export function useLoad(): (load: Load, id: string) => Promise<boolean> {
  const { loadGroup } = useSync();
  return (load, id) => {
    const loaded = loadGroup(load.group(id));
    const timedOut = new Promise<boolean>((resolve) => {
      setTimeout(() => resolve(false), loadWait);
    });
    return Promise.race([loaded, timedOut]);
  };
}
