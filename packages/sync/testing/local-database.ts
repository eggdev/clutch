import {
  emptiedPosition,
  fullSave,
  leftBehind,
  markAfter,
  stateOf,
} from '@repo/sync/runtime/pool-doors';
import type { MarkState } from '@repo/sync/runtime/pool-doors';
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
  /** The number of saves that this handle wrote, not counting a save that wrote nothing. */
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
  // The mark of a session end, which a clear leaves.
  let ended: MarkState | undefined;
  // The generation of the rows, which each clear writes anew.
  let generation = 0;
  const log: Array<LocalSave> = [];
  // The lost listeners of each handle, as a `BroadcastChannel` of each tab.
  const handles = new Set<() => void>();

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
      const at = transactions.findIndex(({ id }) => id === transaction.id);
      transactions.splice(
        at === -1 ? transactions.length : at,
        at === -1 ? 0 : 1,
        structuredClone(transaction),
      );
    }
    const { mark, sweep } = markAfter(ended, save);
    ended = mark;
    if (sweep) {
      transactions = transactions.filter((row) => !leftBehind(row, save));
    }
  }

  /** The records in the order of their keys, as IndexedDB and SQLite read them. */
  function inKeyOrder(): Array<SavedRecord> {
    return [...records.keys()].toSorted().flatMap((key) => records.get(key) ?? []);
  }

  if (initial) {
    apply(fullSave(initial));
    ended = initial.ended ? 'fresh' : undefined;
  }

  function handle(writer: Promise<unknown>, held: boolean): MemoryLocalDatabase {
    let isWriter = held;
    let writes = 0;
    // The generation that this handle read when it opened.
    let mine = generation;
    let lost = false;
    const heard = new Set<() => void>();
    function wake() {
      if (!lost) {
        lost = true;
        for (const listener of heard) {
          listener();
        }
      }
    }
    handles.add(wake);
    return {
      read: () =>
        Promise.resolve(
          structuredClone(stateOf(inKeyOrder(), position, transactions, ended === 'fresh')),
        ),
      save: (save) => {
        if (mine !== generation) {
          wake();
          return Promise.resolve('cleared');
        }
        apply(save);
        log.push(structuredClone(save));
        writes += 1;
        return Promise.resolve('saved');
      },
      makeRoom: () => {
        if (mine !== generation) {
          wake();
          return Promise.resolve('cleared');
        }
        records.clear();
        position = emptiedPosition(position);
        return Promise.resolve('saved');
      },
      clear: () => {
        for (const other of handles) {
          // A message reaches each other handle in a later task, as a
          // `BroadcastChannel` message does on the web.
          if (other !== wake) {
            setTimeout(other, 0);
          }
        }
        records.clear();
        transactions = [];
        position = undefined;
        ended = 'fresh';
        generation += 1;
        mine = generation;
        return Promise.resolve();
      },
      onLost(listener) {
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
