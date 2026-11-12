/** One value that a SQL statement binds. */
export type SqlValue = string | number | null;

/**
 * The seam between the SQLite adapter and a SQLite library. The adapter in
 * `packages/sync/runtime/sqlite.ts` runs on any library that gives these two
 * calls: op-sqlite on a device, and the SQLite of Bun in tests.
 */
export type SqliteDriver = {
  readonly run: (sql: string, params?: ReadonlyArray<SqlValue>) => Promise<void>;
  readonly all: (
    sql: string,
    params?: ReadonlyArray<SqlValue>,
  ) => Promise<ReadonlyArray<Readonly<Record<string, unknown>>>>;
};
