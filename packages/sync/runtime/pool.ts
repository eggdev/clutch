import type { Replayable, Waits } from '@repo/sync/contract/command';
import { stamped } from '@repo/sync/contract/fields';
import type { CallOf, Fields } from '@repo/sync/contract/fields';
import type { Model, RecordRow } from '@repo/sync/contract/record';
import {
  consoleReport,
  declarationsByName,
  deltaRecordMisfit,
  deviceStamps,
  runMisfit,
  savedCommandMisfit,
  savedRecordsMisfit,
} from '@repo/sync/runtime/pool-doors';
import type { PoolDeclarations, PoolOptions } from '@repo/sync/runtime/pool-doors';
import {
  copy,
  draftOver,
  groupWaits,
  keepUnchanged,
  listenerMap,
  readAs,
  recordKey,
  sameJson,
  sortedIds,
  tableOf,
  wake,
} from '@repo/sync/runtime/tables';
import type { Tables } from '@repo/sync/runtime/tables';
import type { PoolState, RecordMeta } from '@repo/sync/types/local-database';
import type { Change, Delta, Outcome, Transaction } from '@repo/sync/types/protocol';
import type { ReadablePool, Rejection } from '@repo/sync/types/records';

type Pending = { readonly transaction: Transaction; sent: boolean; acceptedAt: number | null };

/** The object pool, with the writes that only the sync engine and commands use. */
export type Pool = ReadablePool & {
  /**
   * Runs a command and returns the ID of its transaction. The pool fills the
   * stamps of the input that the caller left out: a new ID, and the time.
   */
  readonly run: <F extends Fields>(
    command: { readonly name: string; readonly input: F; readonly waits: Waits },
    input: CallOf<F>,
  ) => string;
  readonly isPending: (transactionId: string) => boolean;
  readonly lastSyncId: () => number;
  readonly load: (state: PoolState) => void;
  readonly snapshot: () => PoolState;
  readonly unsent: () => ReadonlyArray<Transaction>;
  readonly markSent: (ids: ReadonlyArray<string>, sent: boolean) => void;
  readonly applyDeltas: (deltas: ReadonlyArray<Delta>) => void;
  /**
   * Sets the loaded groups. It applies the backfill of each new group, and
   * deletes each confirmed record that is in no loaded group.
   */
  readonly applyGroups: (loaded: ReadonlyArray<string>, backfill: ReadonlyArray<Delta>) => void;
  /** The groups loaded now, which the engine names when it connects. */
  readonly loadedGroups: () => ReadonlyArray<string>;
  /**
   * Asks the engine to load a group. It resolves `true` once the records of
   * the group are in the pool, and `false` when the server refuses the group.
   */
  readonly loadGroup: (group: string) => Promise<boolean>;
  /** The server will not load this group for the actor. Only the engine uses it. */
  readonly refuseGroup: (group: string) => void;
  /** The groups that a gate asked for and that are not loaded yet. */
  readonly requestedGroups: () => ReadonlyArray<string>;
  /** Wakes when a gate asks for a group. Only the engine uses it. */
  readonly onLoadRequest: (listener: (group: string) => void) => () => void;
  readonly resetConfirmed: () => void;
  /**
   * The engine names the build by the digest of its contracts. A saved copy
   * that another build left a record out of is then loaded again from 0.
   */
  readonly nameBuild: (digest: string) => void;
  readonly settle: (outcomes: ReadonlyArray<Outcome>) => void;
  readonly onPending: (listener: () => void) => () => void;
  /** Wakes after every change to the pool, so the engine can save it. Screens never use it. */
  readonly onChange: (listener: () => void) => () => void;
};

/**
 * Creates the object pool. Confirmed records come only from server deltas.
 * What screens see is the confirmed records with each pending local change
 * applied again on top, so a delta rebases pending work and a rejection rolls
 * it back. `changes` lists the local change of every command that shows at
 * once, so a pending transaction loaded from the local database can run its
 * local change again.
 *
 * Each change keeps every record that did not change as the same object, and
 * wakes only the watchers of the models and records that changed. A rename of
 * one record re-renders the one component that reads it.
 *
 * `declarations` lists the records and commands that the doors check against.
 * `options.stamps` gives each new ID and the time of each run. Only the pool
 * reads the clock and makes IDs on the client, so a test that gives its own
 * stamps gets the same records on every run.
 */
export function createPool(
  changes: ReadonlyArray<Replayable>,
  declarations: PoolDeclarations,
  options: PoolOptions = {},
): Pool {
  const stamps = options.stamps ?? deviceStamps;
  const report = options.report ?? consoleReport;
  const declared = declarationsByName(declarations.records);
  const byName = new Map(changes.map((change) => [change.name, change]));
  let confirmed: Tables = new Map();
  let visible: Tables = new Map();
  let pending: Array<Pending> = [];
  let lastSyncId = 0;
  let rejection: Rejection | undefined;
  // The groups and last sync ID of each confirmed record, by `recordKey`.
  let meta = new Map<string, RecordMeta>();
  let loaded = new Set<string>();
  // The build that left a record of a delta out of the confirmed records, if one did.
  let leftOutBy: string | undefined;
  let build = 'unnamed';
  const waits = groupWaits();
  // The ID lists handed out, keyed by model and order. A list is rebuilt only
  // after its model changes, and the old array is kept when the IDs match.
  const idLists = new Map<string, { ids: ReadonlyArray<string>; stale: boolean }>();
  const modelWatchers = listenerMap();
  const recordWatchers = listenerMap();
  const rejectionWatchers = new Set<() => void>();
  const changeListeners = new Set<() => void>();
  const pendingListeners = new Set<() => void>();

  function recompute() {
    const next = copy(confirmed);
    const draft = draftOver(next);
    for (const { transaction } of pending) {
      byName.get(transaction.command)?.replay(draft, transaction.input);
    }
    const changed = keepUnchanged(visible, next);
    visible = next;
    const models = new Set(changed.map(([name]) => name));
    for (const [key, list] of idLists) {
      if (models.has(key.slice(0, key.indexOf('\u0000')))) {
        list.stale = true;
      }
    }
    for (const [name, id] of changed) {
      recordWatchers.wake(recordKey(name, id));
    }
    for (const name of models) {
      modelWatchers.wake(name);
    }
    wake(changeListeners);
  }

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
      tableOf(confirmed, change.model).set(change.id, row);
      meta.set(key, { groups: change.groups, syncId });
    } else {
      tableOf(confirmed, change.model).delete(change.id);
      meta.delete(key);
    }
  }

  /** Records a refusal the way the server's refusal is recorded, and wakes the rejection watchers. */
  function refuse(transactionId: string, command: string, reason: string) {
    rejection = { transactionId, command, code: 'invalid-input', reason };
    wake(rejectionWatchers);
  }

  /** Deletes each confirmed record that is in no loaded group. */
  function purge() {
    const current = loaded;
    for (const [key, { groups }] of meta) {
      if (!groups.some((group) => current.has(group))) {
        const [model = '', id = ''] = key.split('\u0000');
        confirmed.get(model)?.delete(id);
        meta.delete(key);
      }
    }
  }

  function wakeLoaded() {
    waits.wake((group) => loaded.has(group));
  }

  function dropSettled() {
    pending = pending.filter(({ acceptedAt }) => acceptedAt === null || acceptedAt > lastSyncId);
  }

  function resetConfirmed() {
    confirmed = new Map();
    meta = new Map();
    lastSyncId = 0;
    leftOutBy = undefined;
    for (const entry of pending) {
      entry.sent = false;
      entry.acceptedAt = null;
    }
    recompute();
    wake(pendingListeners);
  }

  return {
    get: <Row extends RecordRow>(model: Model<Row>, id: string) => readAs(model, visible, id),
    ids(model, order, where) {
      const key = `${model.name}\u0000${order ? `${order.by}:${order.direction}` : ''}\u0000${where ? `${where.field}=${where.equals}` : ''}`;
      const cached = idLists.get(key);
      if (cached && !cached.stale) {
        return cached.ids;
      }
      const ids = sortedIds(visible.get(model.name), order, where);
      const kept = cached && sameJson(cached.ids, ids) ? cached.ids : ids;
      idLists.set(key, { ids: kept, stale: false });
      return kept;
    },
    watchModel: (model, listener) => modelWatchers.add(model.name, listener),
    watchRecord: (model, id, listener) => recordWatchers.add(recordKey(model.name, id), listener),
    lastRejection: () => rejection,
    watchRejection(listener) {
      rejectionWatchers.add(listener);
      return () => rejectionWatchers.delete(listener);
    },
    run(command, input) {
      if (command.waits === 'local' && !byName.has(command.name)) {
        throw new Error(
          `The command ${command.name} shows at once, and this pool has no local change for it. Add its local change to the list that the app gives the pool.`,
        );
      }
      const id = stamps.newId();
      const filled = stamped(command.input, input, stamps);
      // Door 3: a caller that the compiler did not see gets a refusal, and nothing is queued.
      const misfit = runMisfit(command, filled);
      if (misfit) {
        refuse(id, command.name, misfit);
        return id;
      }
      pending.push({
        transaction: { id, command: command.name, input: filled },
        sent: false,
        acceptedAt: null,
      });
      recompute();
      wake(pendingListeners);
      return id;
    },
    isPending: (transactionId) =>
      pending.some(({ transaction }) => transaction.id === transactionId),
    lastSyncId: () => lastSyncId,
    load(state) {
      const misfit = savedRecordsMisfit(state, declared);
      if (misfit) {
        report(misfit);
        meta = new Map();
        loaded = new Set();
        confirmed = new Map();
        lastSyncId = 0;
        leftOutBy = undefined;
        // The pool asks the server again for each group of the dropped copy.
        for (const group of Array.isArray(state.groups) ? state.groups : []) {
          waits.keep(group);
        }
      } else {
        meta = new Map(Object.entries(state.meta));
        loaded = new Set(state.groups);
        confirmed = new Map(
          Object.entries(state.tables).map(([name, rows]) => [
            name,
            new Map(rows.map((row) => [row.id, row])),
          ]),
        );
        ({ lastSyncId, leftOutBy } = state);
        wakeLoaded();
      }
      pending = [];
      // A copy with another shape may hold no list of saved commands.
      for (const transaction of Array.isArray(state.pending) ? state.pending : []) {
        const reason = savedCommandMisfit(transaction, declarations.commands);
        if (reason) {
          report(reason);
          refuse(transaction.id, transaction.command, reason);
        } else {
          pending.push({ transaction, sent: false, acceptedAt: null });
        }
      }
      recompute();
    },
    snapshot: () => ({
      lastSyncId,
      groups: [...loaded],
      meta: Object.fromEntries(meta),
      tables: Object.fromEntries(
        [...confirmed].map(([name, table]) => [name, [...table.values()]]),
      ),
      pending: pending.map(({ transaction }) => transaction),
      ...(leftOutBy === undefined ? {} : { leftOutBy }),
    }),
    unsent: () => pending.filter(({ sent }) => !sent).map(({ transaction }) => transaction),
    markSent(ids, sent) {
      for (const entry of pending) {
        if (ids.includes(entry.transaction.id)) {
          entry.sent = sent;
        }
      }
    },
    applyDeltas(deltas) {
      for (const delta of deltas) {
        if (delta.syncId <= lastSyncId) {
          continue;
        }
        for (const change of delta.changes) {
          applyChange(change, delta.syncId);
        }
        lastSyncId = delta.syncId;
        pending = pending.filter(({ transaction }) => transaction.id !== delta.transactionId);
      }
      dropSettled();
      recompute();
    },
    applyGroups(groups, backfill) {
      loaded = new Set(groups);
      for (const delta of backfill) {
        for (const change of delta.changes) {
          applyChange(change, delta.syncId);
        }
      }
      purge();
      recompute();
      wakeLoaded();
    },
    loadedGroups: () => [...loaded],
    loadGroup: (group) => (loaded.has(group) ? Promise.resolve(true) : waits.wait(group)),
    refuseGroup(group) {
      report(
        `The server refused to load ${group} for this account, so its screen shows no records.`,
      );
      waits.refuse(group);
    },
    requestedGroups: waits.requested,
    onLoadRequest: waits.onRequest,
    resetConfirmed,
    nameBuild(digest) {
      build = digest;
      if (leftOutBy !== undefined && leftOutBy !== digest) {
        report(
          'Another build of this app left out a record that it could not read, so this build loads each record again from the server.',
        );
        resetConfirmed();
      }
    },
    settle(outcomes) {
      const before = rejection;
      for (const outcome of outcomes) {
        const entry = pending.find(({ transaction }) => transaction.id === outcome.transactionId);
        if (!entry) {
          continue;
        }
        if (outcome.status === 'rejected') {
          pending = pending.filter((item) => item !== entry);
          rejection = {
            transactionId: outcome.transactionId,
            command: entry.transaction.command,
            code: outcome.code ?? 'failed',
            reason: outcome.reason ?? 'rejected',
          };
        } else {
          entry.acceptedAt = outcome.syncId;
        }
      }
      dropSettled();
      recompute();
      if (rejection !== before) {
        wake(rejectionWatchers);
      }
    },
    onPending(listener) {
      pendingListeners.add(listener);
      return () => pendingListeners.delete(listener);
    },
    onChange(listener) {
      changeListeners.add(listener);
      return () => changeListeners.delete(listener);
    },
  };
}
