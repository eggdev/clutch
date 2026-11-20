import { Database } from 'bun:sqlite';
import { expect, test } from 'bun:test';

import { localChange } from '@repo/sync/contract/command';
import { defineContract } from '@repo/sync/contract/define';
import { loadPool } from '@repo/sync/runtime/boot';
import { createPool } from '@repo/sync/runtime/pool';
import { fullSave } from '@repo/sync/runtime/pool-doors';
import { openSqlite } from '@repo/sync/runtime/sqlite';
import {
  expectOldLayoutMoved,
  localDatabaseCases,
  oldLayoutCopy,
} from '@repo/sync/testing/local-database-conformance';
import {
  poolState,
  testCommand,
  testGroup,
  testModel,
  testStamps,
} from '@repo/sync/testing/pool-state';
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

test('a delete of the records that stops part way leaves sync ID 0, and the next start loads exactly the server records', async () => {
  const database = new Database(':memory:');
  const driver = bunDriver(database);
  let full = false;
  let batches = 0;
  const failing: SqliteDriver = {
    ...driver,
    run: (sql, params) => {
      // The large delete fails, and so does the second small one.
      const batch = sql.startsWith('delete from pool_records where rowid in');
      batches += full && batch ? 1 : 0;
      if (full && (sql === 'delete from pool_records where name = ?' || batches === 2)) {
        return Promise.reject(new Error('database or disk is full'));
      }
      return driver.run(sql, params);
    },
  };
  const card = testModel('Card', { id: 'string', title: 'string' });
  const rename = testCommand('cards/rename', { id: 'string', title: 'string' }, 'local');
  const renameLocal = localChange(rename, (draft, input) => {
    draft.put(card, input);
  });
  const cards = defineContract('cards', { records: [card], commands: [rename], loads: [] });
  const ana = { userId: 'ana', organizationId: 'acme' };
  const saved = Array.from({ length: 1200 }, (_, index) => ({ id: `c${index}`, title: 'Saved' }));
  const local = await openSqlite(failing, 'app');
  await local.save(
    fullSave({ ...poolState({ lastSyncId: 77, tables: { Card: saved } }), actor: ana }),
  );
  full = true;
  await expect(local.makeRoom()).rejects.toThrow('database or disk is full');
  full = false;
  const half = await local.read();
  expect(half?.lastSyncId).toBe(0);
  expect(half?.tables.Card).toHaveLength(700);

  // The next start pulls from 0. The server holds 1000 of the cards now, with new titles.
  const next = await loadPool(
    await openSqlite(driver, 'app'),
    [renameLocal],
    [cards],
    testStamps(),
  );
  expect(next.lastSyncId()).toBe(0);
  expect(next.confirmActor(ana)).toBe(true);
  const server = saved.slice(0, 1000).map(({ id }) => ({
    model: 'Card',
    id,
    action: 'upsert' as const,
    data: { title: `Server ${id}` },
    groups: [testGroup],
  }));
  next.applyGroups([testGroup], [{ syncId: 90, transactionId: null, changes: server }]);
  next.applyDeltas([{ syncId: 90, transactionId: null, changes: [] }]);
  expect(next.ids(card).toSorted()).toEqual(server.map(({ id }) => id).toSorted());
  expect(next.get(card, 'c999')?.title).toBe('Server c999');
  await new Promise((resolve) => {
    setTimeout(resolve, 10);
  });
  await next.stop();
  const after = await local.read();
  expect(after?.lastSyncId).toBe(90);
  expect(after?.tables.Card?.map(({ id }) => id).toSorted()).toEqual(
    server.map(({ id }) => id).toSorted(),
  );
  database.close();
});
