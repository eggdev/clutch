import type { RecordRow } from '@repo/sync/contract/record';
import type { Transaction } from '@repo/sync/types/protocol';

/** The sync groups of one confirmed record, and the sync ID of its last change. */
export type RecordMeta = { readonly groups: ReadonlyArray<string>; readonly syncId: number };

/**
 * What the local database keeps: the confirmed records, the groups the client
 * loaded, each record's groups, and the transactions that wait. `meta` is
 * keyed by `<model> <id>`.
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
};

/**
 * The seam of the local database. Only the sync engine reads or writes it. Each
 * platform has one adapter: IndexedDB on the web, in
 * `packages/sync/runtime/indexed-db.ts`, and SQLite on native, in
 * `packages/sync/runtime/sqlite.ts`. `openLocalDatabase` in
 * `runtime/local-database.ts` picks the one of the platform. Each adapter
 * passes the cases in `testing/local-database-conformance.ts`, and a fake for
 * tests is in `testing/`. See
 * docs/contributing/architecture/client.md#local-database.
 */
export type LocalDatabase = {
  readonly read: () => Promise<PoolState | undefined>;
  readonly write: (state: PoolState) => Promise<void>;
  readonly clear: () => Promise<void>;
};
