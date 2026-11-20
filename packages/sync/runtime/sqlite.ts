import { oldLayoutSave, stateOf } from '@repo/sync/runtime/pool-doors';
import type { LocalDatabase, LocalSave } from '@repo/sync/types/local-database';
import type { SqliteDriver } from '@repo/sync/types/sqlite-driver';

/**
 * The native adapter of the local database. Each name has one row for each
 * confirmed record in `pool_records`, one row for each waiting transaction
 * in `pool_transactions`, and one row for the sync position in
 * `pool_position`. Each value is JSON text. Only the sync engine reads or
 * writes it. The object pool checks each saved copy against the contracts as
 * it loads it, so this file checks only the outer shape of each row.
 *
 * The old layout kept the whole state of a name as one JSON row in the table
 * `pool`. The open moves that row into the new tables and deletes it.
 */

/** The saved text as a value. Text that is no JSON gives `undefined`, which the read counts as a row with another shape. */
function parsed(text: unknown): unknown {
  if (typeof text !== 'string') {
    return undefined;
  }
  try {
    return JSON.parse(text);
  } catch {
    return undefined;
  }
}

function noOtherTab() {
  // One process uses the file, so no other tab clears it.
}

const schema = [
  'create table if not exists pool_records (name text not null, model text not null, id text not null, value text not null, primary key (name, model, id))',
  'create table if not exists pool_transactions (seq integer primary key autoincrement, name text not null, id text not null, value text not null, unique (name, id))',
  'create table if not exists pool_position (name text primary key, value text not null)',
];

export async function openSqlite(driver: SqliteDriver, name: string): Promise<LocalDatabase> {
  // One statement list at a time, so a database transaction never starts inside another.
  let queue: Promise<unknown> = Promise.resolve();
  function serial<T>(work: () => Promise<T>): Promise<T> {
    const previous = queue;
    const next = (async () => {
      try {
        await previous;
      } catch {
        // The caller of the work before got its error.
      }
      return work();
    })();
    queue = next;
    return next;
  }

  /** Runs `work` in one database transaction: all of it commits, or none of it does. */
  async function atomically(work: () => Promise<void>): Promise<void> {
    await driver.run('begin');
    try {
      await work();
      await driver.run('commit');
    } catch (error) {
      await driver.run('rollback');
      throw error;
    }
  }

  async function write(save: LocalSave): Promise<void> {
    const { confirmed } = save;
    if (confirmed) {
      if (confirmed.replace) {
        await driver.run('delete from pool_records where name = ?', [name]);
      }
      for (const { model, id } of confirmed.remove) {
        await driver.run('delete from pool_records where name = ? and model = ? and id = ?', [
          name,
          model,
          id,
        ]);
      }
      for (const record of confirmed.put) {
        await driver.run(
          'insert into pool_records (name, model, id, value) values (?, ?, ?, ?) on conflict (name, model, id) do update set value = excluded.value',
          [name, record.model, record.id, JSON.stringify(record)],
        );
      }
      await driver.run(
        'insert into pool_position (name, value) values (?, ?) on conflict (name) do update set value = excluded.value',
        [name, JSON.stringify(confirmed.position)],
      );
    }
    for (const id of save.done) {
      await driver.run('delete from pool_transactions where name = ? and id = ?', [name, id]);
    }
    for (const transaction of save.add) {
      // A transaction that is saved already keeps its place in the order.
      await driver.run(
        'insert into pool_transactions (name, id, value) values (?, ?, ?) on conflict (name, id) do nothing',
        [name, transaction.id, JSON.stringify(transaction)],
      );
    }
  }

  for (const statement of schema) {
    await driver.run(statement);
  }
  const [old] = await driver.all(
    "select name from sqlite_master where type = 'table' and name = 'pool'",
  );
  if (old) {
    const [row] = await driver.all('select state from pool where name = ?', [name]);
    if (row) {
      await atomically(async () => {
        await write(oldLayoutSave(parsed(row['state'])));
        await driver.run('delete from pool where name = ?', [name]);
      });
    }
  }

  return {
    read: () =>
      serial(async () => {
        const records = await driver.all(
          'select value from pool_records where name = ? order by model, id',
          [name],
        );
        const [position] = await driver.all('select value from pool_position where name = ?', [
          name,
        ]);
        const waiting = await driver.all(
          'select value from pool_transactions where name = ? order by seq',
          [name],
        );
        return stateOf(
          records.map((row) => parsed(row['value'])),
          position ? parsed(position['value']) : undefined,
          waiting.map((row) => parsed(row['value'])),
        );
      }),
    save: (save) => serial(() => atomically(() => write(save))),
    clear: () =>
      serial(() =>
        atomically(async () => {
          for (const table of ['pool_records', 'pool_transactions', 'pool_position']) {
            await driver.run(`delete from ${table} where name = ?`, [name]);
          }
        }),
      ),
    onClearedElsewhere: () => noOtherTab,
    // One process uses the file, so it writes from the start.
    isWriter: () => true,
    writer: Promise.resolve(),
  };
}
