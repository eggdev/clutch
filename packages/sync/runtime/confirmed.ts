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
import type { Change, Delta, SyncActor } from '@repo/sync/types/protocol';

/** The part of a saved state that the confirmed records keep. The pool adds the waiting transactions. */
type ConfirmedState = Omit<PoolState, 'pending'>;

/**
 * The confirmed records of the object pool: what the server sent, and
 * nothing that waits. The pool puts each waiting change on top of them.
 */
export type Confirmed = {
  /** The confirmed tables. The pool reads them under each waiting change, and never writes them. */
  readonly tables: () => Tables;
  /**
   * The keys of the records that changed since the last call, or `all` after
   * a load or a reset. The pool puts only these records in step.
   */
  readonly takeTouched: () => ReadonlySet<string> | 'all';
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
  /** Forgets every record and the sync position. The loaded groups and the actor stay. */
  readonly reset: () => void;
  /** The actor that these records belong to, or `undefined` for a copy that names none. */
  readonly actor: () => SyncActor | undefined;
  /** Names the actor of these records. The next save writes it with the position. */
  readonly setActor: (actor: SyncActor) => void;
  /**
   * A `Groups` message of this session came. Each save after it removes the
   * mark of a session end, also when the server named no actor.
   */
  readonly hearServer: () => void;
  /** Applies a delta and returns `true`, or returns `false` when the pool already has it. */
  readonly applyDelta: (delta: Delta) => boolean;
  /** Applies each change of a backfill. A backfill does not move the sync position. */
  readonly applyBackfill: (backfill: ReadonlyArray<Delta>) => void;
  /**
   * A `Groups` message ended a load. The first one of a pull from sync ID 0
   * ends the snapshot of every loaded group, so each record that the pull did
   * not send goes.
   */
  readonly endLoad: () => void;
  /**
   * The pull ended, and the next one sends its records again. When a load was
   * `cutOff`, it purges, and it returns whether it did.
   */
  readonly endPull: (cutOff: boolean) => boolean;
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
 * each record that the pool holds in a loaded group, a row with no record for
 * each deleted record, and a key to remove for each other one. A record that
 * is in no loaded group is not written: its key is removed, and it is `held`
 * for the save after its group loads.
 */
function savedRows(
  keys: Iterable<string>,
  meta: ReadonlyMap<string, RecordMeta>,
  tables: Tables,
  loaded: ReadonlySet<string>,
) {
  const put: Array<SavedRecord> = [];
  const remove: Array<RecordKey> = [];
  const held: Array<string> = [];
  for (const key of keys) {
    const [model = '', id = ''] = key.split('\u0000');
    const known = meta.get(key);
    const row = known?.deleted ? null : tables.get(model)?.get(id);
    if (known && row !== undefined && (row === null || known.groups.some((g) => loaded.has(g)))) {
      put.push({ model, id, row, groups: known.groups, syncId: known.syncId });
    } else {
      remove.push({ model, id });
      if (known && row) {
        held.push(key);
      }
    }
  }
  return { put, remove, held };
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
  // The groups and last sync ID of each confirmed record, by `recordKey`. A
  // deleted record keeps an entry marked `deleted`, so an older upsert of it
  // does not bring it back. The pool forgets these marks only in `reset` and
  // when it drops a saved copy, so they grow with the deletes that the device
  // sees. Snapshots of the server (CL-917) may make them unnecessary.
  let meta = new Map<string, RecordMeta>();
  let loaded = new Set<string>();
  // The keys of the records that changed since the last save, or every
  // record after the confirmed records were dropped.
  let unsaved = new Set<string>();
  let unsavedAll = false;
  // The same for the visible tables of the pool, since its last change.
  let touched = new Set<string>();
  let touchedAll = true;
  // The build that left a record of a delta out of the confirmed records, if one did.
  let leftOutBy: string | undefined;
  let build = 'unnamed';
  let actor: SyncActor | undefined;
  let heard = false;
  // The keys of the records that a backfill of this pull sent since its last
  // `Groups` message, and whether a `Groups` message of this pull came.
  let sent = new Set<string>();
  let opened = false;

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
      meta.set(key, { groups: change.groups, syncId, deleted: true });
    }
    unsaved.add(key);
    touched.add(key);
  }

  function drop(key: string) {
    const [model = '', id = ''] = key.split('\u0000');
    tables.get(model)?.delete(id);
    meta.delete(key);
    unsaved.add(key);
    touched.add(key);
  }

  function purge() {
    const current = new Set([...loaded, ...loading()]);
    for (const [key, { groups, deleted }] of meta) {
      // A deleted record keeps its mark, so a later backfill of another group cannot bring it back.
      if (!deleted && !groups.some((group) => current.has(group))) {
        drop(key);
      }
    }
  }

  function reset() {
    tables = new Map();
    meta = new Map();
    unsaved = new Set();
    unsavedAll = true;
    touchedAll = true;
    lastSyncId = 0;
    leftOutBy = undefined;
  }

  return {
    tables: () => tables,
    takeTouched() {
      const taken = touchedAll ? 'all' : touched;
      touched = new Set();
      touchedAll = false;
      return taken;
    },
    lastSyncId: () => lastSyncId,
    loaded: () => loaded,
    load(state) {
      // A copy that does not fit keeps its actor, because its waiting
      // transactions stay and belong to that actor.
      ({ actor } = state);
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
      touchedAll = true;
      return true;
    },
    snapshot: () => ({
      lastSyncId,
      groups: [...loaded],
      meta: Object.fromEntries(meta),
      tables: Object.fromEntries([...tables].map(([name, table]) => [name, [...table.values()]])),
      ...(leftOutBy === undefined ? {} : { leftOutBy }),
      ...(actor === undefined ? {} : { actor }),
    }),
    changes(everything) {
      const replace = everything || unsavedAll;
      const keys = replace ? meta.keys() : unsaved;
      const { put, remove, held } = savedRows(keys, meta, tables, loaded);
      unsaved = new Set(held);
      unsavedAll = false;
      return {
        replace,
        put,
        remove: replace ? [] : remove,
        position: {
          lastSyncId,
          groups: [...loaded],
          ...(leftOutBy === undefined ? {} : { leftOutBy }),
          ...(actor === undefined ? {} : { actor }),
        },
        ...(heard ? { heardServer: true } : {}),
      };
    },
    reset,
    actor: () => actor,
    setActor(next) {
      actor = next;
    },
    hearServer() {
      heard = true;
    },
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
          sent.add(recordKey(change.model, change.id));
        }
      }
    },
    endLoad() {
      for (const [key, { deleted }] of opened || lastSyncId > 0 ? [] : meta) {
        if (!deleted && !sent.has(key)) {
          drop(key);
        }
      }
      sent = new Set();
      opened = true;
    },
    endPull(cutOff) {
      sent = new Set();
      opened = false;
      if (cutOff) {
        purge();
      }
      return cutOff;
    },
    setLoaded(groups) {
      loaded = new Set(groups);
    },
    purge,
    nameBuild(digest) {
      build = digest;
      return leftOutBy !== undefined && leftOutBy !== digest;
    },
  };
}
