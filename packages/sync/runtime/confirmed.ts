import type { RecordDeclaration } from '@repo/sync/contract/record';
import {
  declarationsByName,
  deltaRecordMisfit,
  savedRecordsMisfit,
} from '@repo/sync/runtime/pool-doors';
import type { Report } from '@repo/sync/runtime/pool-doors';
import { recordKey, tableOf } from '@repo/sync/runtime/tables';
import type { Tables } from '@repo/sync/runtime/tables';
import type {
  ConfirmedSave,
  PoolState,
  RecordKey,
  RecordMeta,
  SavedRecord,
} from '@repo/sync/types/local-database';
import type { Change, Delta } from '@repo/sync/types/protocol';

/** The part of a saved state that the confirmed records keep. The pool adds the waiting transactions. */
type ConfirmedState = Omit<PoolState, 'pending'>;

/**
 * The confirmed records of the object pool: what the server sent, and
 * nothing that waits. The pool puts each waiting change on top of them.
 */
export type Confirmed = {
  /** The confirmed tables. The pool copies them before it applies a waiting change. */
  readonly tables: () => Tables;
  readonly lastSyncId: () => number;
  readonly loaded: () => ReadonlySet<string>;
  /**
   * Loads the confirmed part of a saved state. It returns `false` when the
   * copy does not fit the declarations, and then holds no records and no groups.
   */
  readonly load: (state: PoolState) => boolean;
  readonly snapshot: () => ConfirmedState;
  /**
   * The records that changed since the last call, the records that were
   * deleted, and the sync position, for the next save. `everything` asks for
   * every record. A load of a dropped copy and a reset ask for every record too.
   */
  readonly changes: (everything: boolean) => ConfirmedSave;
  /** Forgets every record and the sync position. The loaded groups stay. */
  readonly reset: () => void;
  /** Applies a delta and returns `true`, or returns `false` when the pool already has it. */
  readonly applyDelta: (delta: Delta) => boolean;
  /** Applies each change of a backfill. A backfill does not move the sync position. */
  readonly applyBackfill: (backfill: ReadonlyArray<Delta>) => void;
  readonly setLoaded: (groups: ReadonlyArray<string>) => void;
  /** Deletes each record that is in no loaded group, and in no group that loads. */
  readonly purge: () => void;
  /**
   * Names the build. It returns `true` when another build left a record out
   * of these records, so the pool must load each record again from 0.
   */
  readonly nameBuild: (digest: string) => boolean;
};

/**
 * The rows of the confirmed records with these keys, for a save: a row for
 * each record that the pool holds, and a key to remove for each other one.
 */
function savedRows(
  keys: Iterable<string>,
  meta: ReadonlyMap<string, RecordMeta>,
  tables: Tables,
): { readonly put: Array<SavedRecord>; readonly remove: Array<RecordKey> } {
  const put: Array<SavedRecord> = [];
  const remove: Array<RecordKey> = [];
  for (const key of keys) {
    const [model = '', id = ''] = key.split('\u0000');
    const known = meta.get(key);
    const row = tables.get(model)?.get(id);
    if (known && row) {
      put.push({ model, id, row, groups: known.groups, syncId: known.syncId });
    } else {
      remove.push({ model, id });
    }
  }
  return { put, remove };
}

/**
 * Creates the confirmed records. Doors 1 and 2 check each saved record and
 * each record of a delta against `records`. `loading` names the groups whose pages are coming, so
 * a purge keeps their records.
 */
export function createConfirmed(
  records: ReadonlyArray<RecordDeclaration>,
  report: Report,
  loading: () => ReadonlySet<string>,
): Confirmed {
  const declared = declarationsByName(records);
  let tables: Tables = new Map();
  let lastSyncId = 0;
  // The groups and last sync ID of each confirmed record, by `recordKey`.
  let meta = new Map<string, RecordMeta>();
  let loaded = new Set<string>();
  // The keys of the records that changed since the last save, or every
  // record after the confirmed records were dropped.
  let unsaved = new Set<string>();
  let unsavedAll = false;
  // The build that left a record of a delta out of the confirmed records, if one did.
  let leftOutBy: string | undefined;
  let build = 'unnamed';

  /** Applies one change unless the record already holds a later one. Door 2 checks each record. */
  function applyChange(change: Change, syncId: number) {
    const key = recordKey(change.model, change.id);
    const known = meta.get(key);
    if (known && known.syncId > syncId) {
      return;
    }
    if (change.action === 'upsert' && change.data !== null) {
      const row = { ...change.data, id: change.id };
      const misfit = deltaRecordMisfit(declared, change.model, change.id, row);
      if (misfit) {
        report(misfit);
        leftOutBy = build;
        return;
      }
      tableOf(tables, change.model).set(change.id, row);
      meta.set(key, { groups: change.groups, syncId });
    } else {
      tableOf(tables, change.model).delete(change.id);
      meta.delete(key);
    }
    unsaved.add(key);
  }

  function reset() {
    tables = new Map();
    meta = new Map();
    unsaved = new Set();
    unsavedAll = true;
    lastSyncId = 0;
    leftOutBy = undefined;
  }

  return {
    tables: () => tables,
    lastSyncId: () => lastSyncId,
    loaded: () => loaded,
    load(state) {
      const misfit = savedRecordsMisfit(state, declared);
      if (misfit) {
        report(misfit);
        reset();
        loaded = new Set();
        return false;
      }
      meta = new Map(Object.entries(state.meta));
      loaded = new Set(state.groups);
      tables = new Map(
        Object.entries(state.tables).map(([name, rows]) => [
          name,
          new Map(rows.map((row) => [row.id, row])),
        ]),
      );
      ({ lastSyncId, leftOutBy } = state);
      unsaved = new Set();
      unsavedAll = false;
      return true;
    },
    snapshot: () => ({
      lastSyncId,
      groups: [...loaded],
      meta: Object.fromEntries(meta),
      tables: Object.fromEntries([...tables].map(([name, table]) => [name, [...table.values()]])),
      ...(leftOutBy === undefined ? {} : { leftOutBy }),
    }),
    changes(everything) {
      const replace = everything || unsavedAll;
      const { put, remove } = savedRows(replace ? meta.keys() : unsaved, meta, tables);
      unsaved = new Set();
      unsavedAll = false;
      return {
        replace,
        put,
        remove: replace ? [] : remove,
        position: {
          lastSyncId,
          groups: [...loaded],
          ...(leftOutBy === undefined ? {} : { leftOutBy }),
        },
      };
    },
    reset,
    applyDelta(delta) {
      if (delta.syncId <= lastSyncId) {
        return false;
      }
      for (const change of delta.changes) {
        applyChange(change, delta.syncId);
      }
      lastSyncId = delta.syncId;
      return true;
    },
    applyBackfill(backfill) {
      for (const delta of backfill) {
        for (const change of delta.changes) {
          applyChange(change, delta.syncId);
        }
      }
    },
    setLoaded(groups) {
      loaded = new Set(groups);
    },
    purge() {
      const current = new Set([...loaded, ...loading()]);
      for (const [key, { groups }] of meta) {
        if (!groups.some((group) => current.has(group))) {
          const [model = '', id = ''] = key.split('\u0000');
          tables.get(model)?.delete(id);
          meta.delete(key);
          unsaved.add(key);
        }
      }
    },
    nameBuild(digest) {
      build = digest;
      return leftOutBy !== undefined && leftOutBy !== digest;
    },
  };
}
