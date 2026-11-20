import type { RecordRow } from '@repo/sync/contract/record';
import type { Transaction } from '@repo/sync/types/protocol';

/** The sync groups of one confirmed record, and the sync ID of its last change. */
export type RecordMeta = { readonly groups: ReadonlyArray<string>; readonly syncId: number };

/**
 * What the pool loads and what a read of the local database gives: the
 * confirmed records, the groups the client loaded, each record's groups, and
 * the transactions that wait. `meta` is keyed by `<model> <id>`.
 */
export type PoolState = {
  readonly lastSyncId: number;
  readonly tables: Readonly<Record<string, ReadonlyArray<RecordRow>>>;
  readonly groups: ReadonlyArray<string>;
  readonly meta: Readonly<Record<string, RecordMeta>>;
  readonly pending: ReadonlyArray<Transaction>;
  /**
   * The contract digest of the build that left a record of a delta out of
   * this copy, because it could not read the record. Another build drops the
   * confirmed records and loads again from 0, so the record comes back.
   */
  readonly leftOutBy?: string;
  /**
   * The read found a record row or a position row with another shape, so it
   * kept no record and no position. The pool reports it and loads again.
   */
  readonly unreadable?: true;
};

/** The key of one saved confirmed record. */
export type RecordKey = { readonly model: string; readonly id: string };

/** One row of a confirmed record: the record, its groups and the sync ID of its last change. */
export type SavedRecord = RecordKey & {
  readonly row: RecordRow;
  readonly groups: ReadonlyArray<string>;
  readonly syncId: number;
};

/** The one row of the sync position: the last sync ID, the loaded groups and `leftOutBy`. */
export type SyncPosition = Pick<PoolState, 'lastSyncId' | 'groups' | 'leftOutBy'>;

/**
 * The confirmed part of one save: the records that changed, the records that
 * were deleted, and the sync position. `replace` removes every saved record
 * first, and `put` then holds every record of the pool.
 */
export type ConfirmedSave = {
  readonly replace: boolean;
  readonly put: ReadonlyArray<SavedRecord>;
  readonly remove: ReadonlyArray<RecordKey>;
  readonly position: SyncPosition;
};

/**
 * One save, which the adapter writes in one database transaction. `add`
 * holds the waiting transactions that this tab ran since its last save, and
 * `done` the IDs of the ones that left its queue. Only the tab that writes
 * the confirmed records sends `confirmed`.
 */
export type LocalSave = {
  readonly confirmed?: ConfirmedSave;
  readonly add: ReadonlyArray<Transaction>;
  readonly done: ReadonlyArray<string>;
};

/**
 * The seam of the local database. Only the sync engine reads or writes it. It
 * keeps one row for each confirmed record, one row for each waiting
 * transaction and one row for the sync position, so two tabs that share it
 * never erase each other's waiting transactions.
 *
 * Each platform has one adapter: IndexedDB on the web, in
 * `packages/sync/runtime/indexed-db.ts`, and SQLite on native, in
 * `packages/sync/runtime/sqlite.ts`. `openLocalDatabase` in
 * `runtime/local-database.ts` picks the one of the platform. Each adapter
 * passes the cases in `testing/local-database-conformance.ts`, and a fake for
 * tests is in `testing/`. See
 * docs/contributing/architecture/client.md#local-database.
 */
export type LocalDatabase = {
  /** Every row as one state, the waiting transactions in the order they were added. */
  readonly read: () => Promise<PoolState | undefined>;
  readonly save: (save: LocalSave) => Promise<void>;
  /** Removes every row. */
  readonly clear: () => Promise<void>;
  /**
   * Whether this tab writes the confirmed records now. Two tabs hold
   * different groups and positions, so only one tab writes them. A platform
   * with one process has one writer from the start.
   */
  readonly isWriter: () => boolean;
  /** Resolves when this tab becomes the writer, such as after the writer tab closes. */
  readonly writer: Promise<unknown>;
};
