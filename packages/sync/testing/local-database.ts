import { fullSave, stateOf } from '@repo/sync/runtime/pool-doors';
import { recordKey } from '@repo/sync/runtime/tables';
import type {
  LocalDatabase,
  LocalSave,
  PoolState,
  SavedRecord,
  SyncPosition,
} from '@repo/sync/types/local-database';
import type { Transaction } from '@repo/sync/types/protocol';

/** A local database in memory, with what a test reads about its saves. */
export type MemoryLocalDatabase = LocalDatabase & {
  /** The number of saves that this handle wrote. */
  readonly writes: () => number;
  /** Another handle on the same rows, as a second tab has. */
  readonly tab: () => MemoryLocalDatabase;
};

/**
 * A local database in memory, for tests. It keeps the same rows as the real
 * adapters: one for each confirmed record, one for each waiting transaction
 * and one for the sync position. It keeps a copy of each value it gets.
 * `initial` is written as the first rows.
 */
export function memoryLocalDatabase(initial?: PoolState): MemoryLocalDatabase {
  const records = new Map<string, SavedRecord>();
  let transactions: Array<Transaction> = [];
  let position: SyncPosition | undefined;

  function apply(save: LocalSave) {
    const { confirmed } = save;
    if (confirmed) {
      records.clear();
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

  function handle(): MemoryLocalDatabase {
    let writes = 0;
    return {
      read: () => Promise.resolve(structuredClone(stateOf(inKeyOrder(), position, transactions))),
      save: (save) => {
        apply(save);
        writes += 1;
        return Promise.resolve();
      },
      clear: () => {
        records.clear();
        transactions = [];
        position = undefined;
        return Promise.resolve();
      },
      writes: () => writes,
      tab: () => handle(),
    };
  }

  return handle();
}
