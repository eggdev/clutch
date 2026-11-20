import type { RecordRow } from '@repo/sync/contract/record';
import { recordKey } from '@repo/sync/runtime/tables';
import type {
  LocalSave,
  PoolState,
  RecordMeta,
  SavedRecord,
  SyncPosition,
} from '@repo/sync/types/local-database';
import type { Transaction } from '@repo/sync/types/protocol';

/**
 * The rows of the local database, shared by each adapter: how a read joins
 * the rows into one state, and how a copy in the old layout moves into rows.
 * The rows hold whatever the device kept, so each one is checked for its
 * outer shape here. The doors of the pool check the records and the commands
 * in them when the pool loads them.
 */

function isObject(value: unknown): value is Readonly<Record<string, unknown>> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isStrings(value: unknown): value is ReadonlyArray<string> {
  return Array.isArray(value) && value.every((item) => typeof item === 'string');
}

function isRow(value: unknown): value is RecordRow {
  return isObject(value) && typeof value['id'] === 'string';
}

function isSavedRecord(value: unknown): value is SavedRecord {
  return (
    isObject(value) &&
    typeof value['model'] === 'string' &&
    typeof value['id'] === 'string' &&
    isRow(value['row']) &&
    isStrings(value['groups']) &&
    typeof value['syncId'] === 'number'
  );
}

function isPosition(value: unknown): value is SyncPosition {
  return (
    isObject(value) &&
    typeof value['lastSyncId'] === 'number' &&
    isStrings(value['groups']) &&
    (value['leftOutBy'] === undefined || typeof value['leftOutBy'] === 'string')
  );
}

function isTransaction(value: unknown): value is Transaction {
  return isObject(value) && typeof value['id'] === 'string' && typeof value['command'] === 'string';
}

/**
 * Joins the rows of one read into the state that the pool loads. A device
 * with no row reads as `undefined`. A record row or a position row with
 * another shape makes the confirmed part unreadable, so the read keeps no
 * record and no position, and the pool reports it and loads again from the
 * server. A
 * waiting transaction with another shape is left out, since it names no
 * command that could run.
 */
export function stateOf(
  records: ReadonlyArray<unknown>,
  position: unknown,
  transactions: ReadonlyArray<unknown>,
): PoolState | undefined {
  if (records.length === 0 && position === undefined && transactions.length === 0) {
    return undefined;
  }
  const pending = transactions.filter(isTransaction);
  if (!records.every(isSavedRecord) || (position !== undefined && !isPosition(position))) {
    return { lastSyncId: 0, tables: {}, groups: [], meta: {}, pending, unreadable: true };
  }
  const tables: Record<string, Array<RecordRow>> = {};
  const meta: Record<string, RecordMeta> = {};
  for (const { model, id, row, groups, syncId } of records) {
    tables[model] = [...(tables[model] ?? []), row];
    meta[recordKey(model, id)] = { groups, syncId };
  }
  const saved = isPosition(position) ? position : { lastSyncId: 0, groups: [] };
  return {
    lastSyncId: saved.lastSyncId,
    groups: saved.groups,
    tables,
    meta,
    pending,
    ...(saved.leftOutBy === undefined ? {} : { leftOutBy: saved.leftOutBy }),
  };
}

/** The rows of a whole state, as a save that replaces every confirmed record. */
export function fullSave(state: PoolState): LocalSave {
  const put: Array<SavedRecord> = [];
  for (const [model, rows] of Object.entries(state.tables)) {
    for (const row of rows) {
      const known = state.meta[recordKey(model, row.id)];
      put.push({ model, id: row.id, row, groups: known?.groups ?? [], syncId: known?.syncId ?? 0 });
    }
  }
  return {
    confirmed: {
      replace: true,
      put,
      remove: [],
      position: {
        lastSyncId: state.lastSyncId,
        groups: state.groups,
        ...(state.leftOutBy === undefined ? {} : { leftOutBy: state.leftOutBy }),
      },
    },
    add: state.pending,
    done: [],
  };
}

/**
 * Moves a copy in the old layout, one value that held the whole state, into
 * rows. Its waiting transactions always move, so no unsent work is lost. Its
 * records and its position move when every record names its groups and the
 * position has its shape. Otherwise they are dropped, and the pool loads
 * them again from the server.
 */
export function oldLayoutSave(value: unknown): LocalSave {
  if (!isObject(value)) {
    return { add: [], done: [] };
  }
  const { pending } = value;
  const add = Array.isArray(pending) ? pending.filter(isTransaction) : [];
  const { tables, meta } = value;
  const position = {
    lastSyncId: value['lastSyncId'],
    groups: value['groups'],
    ...(value['leftOutBy'] === undefined ? {} : { leftOutBy: value['leftOutBy'] }),
  };
  if (!isObject(tables) || !isObject(meta) || !isPosition(position)) {
    return { add, done: [] };
  }
  const put: Array<SavedRecord> = [];
  for (const [model, rows] of Object.entries(tables)) {
    if (!Array.isArray(rows)) {
      return { add, done: [] };
    }
    for (const row of rows) {
      const known = isRow(row) ? meta[recordKey(model, row.id)] : undefined;
      if (!isRow(row) || !isObject(known) || !isStrings(known['groups'])) {
        return { add, done: [] };
      }
      const syncId = typeof known['syncId'] === 'number' ? known['syncId'] : 0;
      put.push({ model, id: row.id, row, groups: known['groups'], syncId });
    }
  }
  return { confirmed: { replace: true, put, remove: [], position }, add, done: [] };
}
