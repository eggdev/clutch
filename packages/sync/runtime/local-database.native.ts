import { open } from '@op-engineering/op-sqlite';
import { openSqlite } from '@repo/sync/runtime/sqlite';
import type { LocalDatabase } from '@repo/sync/types/local-database';

/**
 * Opens the local database on iOS and Android: one SQLite file through
 * op-sqlite. The native bundler picks this file in place of
 * `local-database.ts`. The adapter in `sqlite.ts` holds the SQL, and its test
 * runs it on the SQLite of Bun.
 */
export function openLocalDatabase(name: string): Promise<LocalDatabase> {
  const database = open({ name: `${name}.sqlite` });
  return openSqlite(
    {
      async run(sql, params) {
        await database.execute(sql, params ? [...params] : undefined);
      },
      async all(sql, params) {
        const result = await database.execute(sql, params ? [...params] : undefined);
        return result.rows;
      },
    },
    name,
  );
}
