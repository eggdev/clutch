import { fullSave, stateOf } from '@repo/sync/runtime/pool-doors';
import { recordKey } from '@repo/sync/runtime/tables';
import type {
  LocalDatabase,
  LocalSave,
  PoolState,
  SavedRecord,
  SyncPosition,
  WaitingRow,
} from '@repo/sync/types/local-database';

/** A local database in memory, with what a test reads about its saves. */
export type MemoryLocalDatabase = LocalDatabase & {
  /** The number of saves that this handle wrote. */
  readonly writes: () => number;
  /** Each save that a handle of these rows wrote, in order. */
  readonly saves: () => ReadonlyArray<LocalSave>;
  /**
   * Another handle on the same rows, as a second tab has. It writes the
   * confirmed records once `writer` resolves.
   */
  readonly tab: (writer: Promise<unknown>) => MemoryLocalDatabase;
};

/**
 * A local database in memory, for tests. It keeps the same rows as the real
 * adapters: one for each confirmed record, one for each waiting transaction
 * and one for the sync position. It keeps a copy of each value it gets.
 * `initial` is written as the first rows. The first handle writes the
 * confirmed records from the start.
 */
export function memoryLocalDatabase(initial?: PoolState): MemoryLocalDatabase {
  const records = new Map<string, SavedRecord>();
  let transactions: Array<WaitingRow> = [];
  let position: SyncPosition | undefined;
  const log: Array<LocalSave> = [];
  // The clear listeners of each handle, as a `BroadcastChannel` of each tab.
  const handles = new Set<Set<() => void>>();

  function apply(save: LocalSave) {
    const { confirmed } = save;
    if (confirmed) {
      if (confirmed.replace) {
        records.clear();
      }
      for (const { model, id } of confirmed.remove) {
        records.delete(recordKey(model, id));
      }
      for (const record of confirmed.put) {
        records.set(recordKey(record.model, record.id), structuredClone(record));
      }
      position = structuredClone(confirmed.position);
    }
    transactions = transactions.filter(({ id }) => !save.done.includes(id));
    for (const transaction of save.add) {
      if (!transactions.some(({ id }) => id === transaction.id)) {
        transactions.push(structuredClone(transaction));
      }
    }
  }

  /** The records in the order of their keys, as IndexedDB and SQLite read them. */
  function inKeyOrder(): Array<SavedRecord> {
    return [...records.keys()].toSorted().flatMap((key) => records.get(key) ?? []);
  }

  if (initial) {
    apply(fullSave(initial));
  }

  function handle(writer: Promise<unknown>, held: boolean): MemoryLocalDatabase {
    let isWriter = held;
    let writes = 0;
    const heard = new Set<() => void>();
    handles.add(heard);
    return {
      read: () => Promise.resolve(structuredClone(stateOf(inKeyOrder(), position, transactions))),
      save: (save) => {
        apply(save);
        log.push(structuredClone(save));
        writes += 1;
        return Promise.resolve();
      },
      clear: () => {
        for (const other of handles) {
          // A message reaches each other handle after the clear starts, as on the web.
          for (const listener of other === heard ? [] : other) {
            queueMicrotask(listener);
          }
        }
        records.clear();
        transactions = [];
        position = undefined;
        return Promise.resolve();
      },
      onClearedElsewhere(listener) {
        heard.add(listener);
        return () => heard.delete(listener);
      },
      isWriter: () => isWriter,
      writer: (async () => {
        await writer;
        isWriter = true;
      })(),
      writes: () => writes,
      saves: () => log,
      tab: (next) => handle(next, false),
    };
  }

  return handle(Promise.resolve(), true);
}
