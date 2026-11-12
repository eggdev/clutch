import type { LocalDatabase } from '@repo/sync/types/local-database';
import type { SqliteDriver } from '@repo/sync/types/sqlite-driver';

/**
 * The native adapter of the local database: one SQLite table that holds the
 * pool state of each name as JSON text in one row. Only the sync engine reads
 * or writes it. The object pool checks each saved copy against the contracts
 * as it loads it, so this file parses the text and checks nothing.
 */
/**
 * The saved text as a value. Text that is no JSON gives an empty object, which
 * the pool drops and reports as a copy that it cannot read.
 */
function parsed(text: string) {
  try {
    return JSON.parse(text);
  } catch {
    return {};
  }
}

export async function openSqlite(driver: SqliteDriver, name: string): Promise<LocalDatabase> {
  await driver.run('create table if not exists pool (name text primary key, state text not null)');
  return {
    read: async () => {
      const [row] = await driver.all('select state from pool where name = ?', [name]);
      const state = row?.['state'];
      return typeof state === 'string' ? parsed(state) : undefined;
    },
    write: (state) =>
      driver.run(
        'insert into pool (name, state) values (?, ?) on conflict (name) do update set state = excluded.state',
        [name, JSON.stringify(state)],
      ),
    clear: () => driver.run('delete from pool where name = ?', [name]),
  };
}
