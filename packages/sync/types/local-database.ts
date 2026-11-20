import type { RecordRow } from '@repo/sync/contract/record';
import type { SyncActor, Transaction } from '@repo/sync/types/protocol';

/**
 * The sync groups of one confirmed record, and the sync ID of its last change.
 * `deleted` marks a record that the server deleted: the pool keeps its sync ID,
 * so an older upsert of it, such as from a backfill, does not bring it back.
 */
export type RecordMeta = {
  readonly groups: ReadonlyArray<string>;
  readonly syncId: number;
  readonly deleted?: true;
};

/**
 * One saved waiting transaction, with the actor that ran it. The pool drops
 * a row of another actor than the one the server confirms, and never sends
 * it. A row from before the actor was saved, or that the pool made before it
 * knew its actor, has none. It takes the actor that the server confirms next.
 */
export type WaitingRow = Transaction & { readonly actor?: SyncActor };

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
  readonly pending: ReadonlyArray<WaitingRow>;
  /**
   * The contract digest of the build that left a record of a delta out of
   * this copy, because it could not read the record. Another build drops the
   * confirmed records and loads again from 0, so the record comes back.
   */
  readonly leftOutBy?: string;
  /**
   * The actor that this copy belongs to. A copy from before the actor was
   * saved has none, and takes the actor that the server names first.
   */
  readonly actor?: SyncActor;
  /**
   * A session ended on this device, and no save has named the actor of the
   * next session yet. The pool drops each waiting row with no actor, because
   * it may be the work of the person who left.
   */
  readonly ended?: true;
  /**
   * The read found a record row or a position row with another shape, so it
   * kept no record and no position. The pool reports it and loads again.
   */
  readonly unreadable?: true;
};

/** The key of one saved confirmed record. */
export type RecordKey = { readonly model: string; readonly id: string };

/**
 * One row of a confirmed record: the record, its groups and the sync ID of its
 * last change. `row` is null for a deleted record, whose sync ID the pool keeps.
 */
export type SavedRecord = RecordKey & {
  readonly row: RecordRow | null;
  readonly groups: ReadonlyArray<string>;
  readonly syncId: number;
};

/**
 * The one row of the sync position: the last sync ID, the loaded groups,
 * `leftOutBy`, and the actor that the copy belongs to.
 */
export type SyncPosition = Pick<PoolState, 'lastSyncId' | 'groups' | 'leftOutBy' | 'actor'>;

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
 * the ones whose actor changed. A row that is saved already keeps its place
 * and takes the new value. `done` holds the IDs of the ones that left its queue. Only the tab that writes
 * the confirmed records sends `confirmed`.
 */
export type LocalSave = {
  readonly confirmed?: ConfirmedSave;
  readonly add: ReadonlyArray<WaitingRow>;
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
  /**
   * Removes every row, and leaves the mark of a session end in the same
   * database transaction. A read reads the mark as `ended` while any other
   * row is there. The first save whose position names an actor removes the
   * mark and each waiting row with no actor. A session end calls it. It
   * first tells each other tab of this database on the device, which then
   * stops its engine and its saves.
   */
  readonly clear: () => Promise<void>;
  /**
   * Wakes when another tab of this database cleared it. It returns the stop
   * of the listener. A platform with one process has no other tab, so it
   * never wakes.
   */
  readonly onClearedElsewhere: (listener: () => void) => () => void;
  /**
   * Whether this tab writes the confirmed records now. Two tabs hold
   * different groups and positions, so only one tab writes them. A platform
   * with one process has one writer from the start.
   */
  readonly isWriter: () => boolean;
  /** Resolves when this tab becomes the writer, such as after the writer tab closes. */
  readonly writer: Promise<unknown>;
};
