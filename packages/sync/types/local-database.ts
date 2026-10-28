import type { Transaction } from '@repo/sync/types/protocol';
import type { RecordRow } from '@repo/sync/types/records';

/** What the local database keeps: the confirmed records and the transactions that wait. */
export type PoolState = {
  readonly lastSyncId: number;
  readonly tables: Readonly<Record<string, ReadonlyArray<RecordRow>>>;
  readonly pending: ReadonlyArray<Transaction>;
};

/**
 * The seam of the local database. Only the sync engine reads or writes it. Each
 * platform has one adapter: IndexedDB on the web, in
 * `packages/sync/runtime/indexed-db.ts`, and SQLite on native, which kickoff
 * adds with a native profile. A fake for tests is in `testing/`. See
 * docs/contributing/architecture/client.md#local-database.
 */
export type LocalDatabase = {
  readonly read: () => Promise<PoolState | undefined>;
  readonly write: (state: PoolState) => Promise<void>;
  readonly clear: () => Promise<void>;
};
