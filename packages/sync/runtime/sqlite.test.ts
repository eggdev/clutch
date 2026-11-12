import { Database } from 'bun:sqlite';
import { expect, test } from 'bun:test';

import { createPool } from '@repo/sync/runtime/pool';
import { openSqlite } from '@repo/sync/runtime/sqlite';
import { localDatabaseCases } from '@repo/sync/testing/local-database-conformance';
import { poolState } from '@repo/sync/testing/pool-state';
import type { SqlValue, SqliteDriver } from '@repo/sync/types/sqlite-driver';

/** The SQLite of Bun as the driver, so the adapter runs on a real SQLite engine. */
function bunDriver(database: Database): SqliteDriver {
  return {
    run: (sql, params = []) => {
      database.query<unknown, Array<SqlValue>>(sql).run(...params);
      return Promise.resolve();
    },
    all: (sql, params = []) =>
      Promise.resolve(database.query<Record<string, unknown>, Array<SqlValue>>(sql).all(...params)),
  };
}

// Each case gets its own database in memory, so `open` returns the same stored data within a case.
for (const item of localDatabaseCases) {
  test(`the SQLite adapter: ${item.name}`, async () => {
    const database = new Database(':memory:');
    expect(await item.run(() => openSqlite(bunDriver(database), 'test'))).toBeUndefined();
    database.close();
  });
}

test('two names in one SQLite file keep separate states', async () => {
  const database = new Database(':memory:');
  const first = await openSqlite(bunDriver(database), 'first');
  const second = await openSqlite(bunDriver(database), 'second');
  await first.write(poolState({ lastSyncId: 1, tables: {} }));
  await second.write(poolState({ lastSyncId: 2, tables: {} }));
  await first.clear();
  expect(await first.read()).toBeUndefined();
  const kept = await second.read();
  expect(kept?.lastSyncId).toBe(2);
  database.close();
});

test('saved text that is no JSON reads as a copy that the pool drops and reports, not as a throw', async () => {
  const database = new Database(':memory:');
  const local = await openSqlite(bunDriver(database), 'app');
  database.query("insert into pool (name, state) values ('app', '{not json')").run();
  const lines: Array<string> = [];
  const pool = createPool(
    [],
    { records: [], commands: [] },
    { report: (line) => lines.push(line) },
  );
  const saved = await local.read();
  expect<unknown>(saved).toEqual({});
  if (saved) {
    pool.load(saved);
  }
  expect(lines).toEqual([
    'The saved copy has another shape than this build reads, so it was dropped, and the pool loads again from the server.',
  ]);
  database.close();
});
