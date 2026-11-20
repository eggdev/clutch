import { Database } from 'bun:sqlite';
import { expect, test } from 'bun:test';

import { createPool } from '@repo/sync/runtime/pool';
import { fullSave } from '@repo/sync/runtime/pool-doors';
import { openSqlite } from '@repo/sync/runtime/sqlite';
import {
  expectOldLayoutMoved,
  localDatabaseCases,
  oldLayoutCopy,
} from '@repo/sync/testing/local-database-conformance';
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
  await first.save(fullSave(poolState({ lastSyncId: 1, tables: {} })));
  await second.save(fullSave(poolState({ lastSyncId: 2, tables: {} })));
  await first.clear();
  expect(await first.read()).toBeUndefined();
  const kept = await second.read();
  expect(kept?.lastSyncId).toBe(2);
  database.close();
});

test('a copy in the old layout moves into the rows, its waiting transactions included', async () => {
  const database = new Database(':memory:');
  database.query('create table pool (name text primary key, state text not null)').run();
  database
    .query('insert into pool (name, state) values (?, ?)')
    .run('app', JSON.stringify(oldLayoutCopy));
  database.query('insert into pool (name, state) values (?, ?)').run('other', '{}');
  await expectOldLayoutMoved(await openSqlite(bunDriver(database), 'app'));
  expect(database.query('select name from pool').all()).toEqual([{ name: 'other' }]);
  // A second open finds no old copy, and reads the same rows.
  await expectOldLayoutMoved(await openSqlite(bunDriver(database), 'app'));
  database.close();
});

test('an old copy whose records name no groups moves only its waiting transactions', async () => {
  const database = new Database(':memory:');
  database.query('create table pool (name text primary key, state text not null)').run();
  const { meta: _meta, ...noGroups } = oldLayoutCopy;
  database
    .query('insert into pool (name, state) values (?, ?)')
    .run('app', JSON.stringify(noGroups));
  const local = await openSqlite(bunDriver(database), 'app');
  const saved = await local.read();
  expect(saved).toEqual({
    lastSyncId: 0,
    tables: {},
    groups: [],
    meta: {},
    pending: oldLayoutCopy.pending,
  });
  database.close();
});

test('a row that is no JSON reads as a copy that the pool drops and reports, not as a throw', async () => {
  const database = new Database(':memory:');
  const local = await openSqlite(bunDriver(database), 'app');
  await local.save(fullSave(oldLayoutCopy));
  database.query("update pool_records set value = '{not json' where id = 'a'").run();
  const lines: Array<string> = [];
  const pool = createPool(
    [],
    { records: [], commands: [] },
    { report: (line) => lines.push(line) },
  );
  const saved = await local.read();
  expect(saved?.tables).toEqual({});
  expect(saved?.pending).toEqual(oldLayoutCopy.pending);
  if (saved) {
    pool.load(saved);
  }
  // The pool declares no command, so it refuses the waiting transaction that the read kept.
  expect(lines).toEqual([
    'The saved copy has another shape than this build reads, so it was dropped, and the pool loads again from the server.',
    'The saved command cards/rename is not declared by this build, so it was not sent.',
  ]);
  database.close();
});

test('a copy from before the generation gets one at its first open, and each handle saves', async () => {
  const database = new Database(':memory:');
  const older = await openSqlite(bunDriver(database), 'app');
  await older.save(fullSave(oldLayoutCopy));
  // An older build kept no generation.
  database.query('delete from pool_generation').run();
  const first = await openSqlite(bunDriver(database), 'app');
  const second = await openSqlite(bunDriver(database), 'app');
  expect(await first.save({ add: [], done: [] })).toBe('saved');
  expect(await second.save({ add: [], done: [] })).toBe('saved');
  const kept = await second.read();
  expect(kept?.pending).toEqual(oldLayoutCopy.pending);
  database.close();
});

test('making room deletes the records in small steps when one large delete fails, and keeps each waiting row', async () => {
  const database = new Database(':memory:');
  const driver = bunDriver(database);
  let full = false;
  let refused = false;
  const local = await openSqlite(
    {
      ...driver,
      run: (sql, params) => {
        // A full device cannot hold the journal of one large delete.
        if (sql === 'delete from pool_records where name = ?' && full && !refused) {
          refused = true;
          return Promise.reject(new Error('database or disk is full'));
        }
        return driver.run(sql, params);
      },
    },
    'app',
  );
  await local.save(
    fullSave({ ...oldLayoutCopy, actor: { userId: 'ana', organizationId: 'acme' } }),
  );
  full = true;
  expect(await local.makeRoom()).toBe('saved');
  expect(refused).toBe(true);
  const read = await local.read();
  expect(read).toEqual({
    lastSyncId: 0,
    tables: {},
    groups: oldLayoutCopy.groups,
    meta: {},
    pending: oldLayoutCopy.pending,
    actor: { userId: 'ana', organizationId: 'acme' },
  });
  database.close();
});
