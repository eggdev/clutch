import {
  copy,
  draftOver,
  keepUnchanged,
  listenerMap,
  recordKey,
  sameJson,
  sortedIds,
  tableOf,
} from '@repo/sync/runtime/tables';
import type { Tables } from '@repo/sync/runtime/tables';
import type { PoolState, RecordMeta } from '@repo/sync/types/local-database';
import type { Change, Delta, Outcome, Transaction } from '@repo/sync/types/protocol';
import type {
  Command,
  Model,
  Order,
  ReadablePool,
  RecordRow,
  Rejection,
  Where,
} from '@repo/sync/types/records';

type Pending = { readonly transaction: Transaction; sent: boolean; acceptedAt: number | null };

/** The object pool, with the writes that only the sync engine and commands use. */
export type Pool = ReadablePool & {
  readonly run: <Input>(command: Command<Input>, input: Input) => string;
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
   * Asks the engine to load a group, and resolves once its records are in
   * the pool. A group that is loaded resolves at once.
   */
  readonly loadGroup: (group: string) => Promise<void>;
  /** The groups that a gate asked for and that are not loaded yet. */
  readonly requestedGroups: () => ReadonlyArray<string>;
  /** Wakes when a gate asks for a group. Only the engine uses it. */
  readonly onLoadRequest: (listener: (group: string) => void) => () => void;
  readonly resetConfirmed: () => void;
  readonly settle: (outcomes: ReadonlyArray<Outcome>) => void;
  readonly onPending: (listener: () => void) => () => void;
  /** Wakes after every change to the pool, so the engine can save it. Screens never use it. */
  readonly onChange: (listener: () => void) => () => void;
};

/**
 * Creates the object pool. Confirmed records come only from server deltas.
 * What screens see is the confirmed records with each pending local change
 * applied again on top, so a delta rebases pending work and a rejection rolls
 * it back. `commands` lists every command, so a pending transaction loaded
 * from the local database can run its local change again.
 *
 * Each change keeps every record that did not change as the same object, and
 * wakes only the watchers of the models and records that changed. A rename of
 * one record re-renders the one component that reads it.
 */
export function createPool(commands: ReadonlyArray<Command<never>>): Pool {
  const byName = new Map(commands.map((command) => [command.name, command]));
  let confirmed: Tables = new Map();
  let visible: Tables = new Map();
  let pending: Array<Pending> = [];
  let lastSyncId = 0;
  let rejection: Rejection | undefined;
  // The groups and last sync ID of each confirmed record, by `recordKey`.
  let meta = new Map<string, RecordMeta>();
  let loaded = new Set<string>();
  const waiters = new Map<string, Array<() => void>>();
  const loadListeners = new Set<(group: string) => void>();
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
      const command = byName.get(transaction.command);
      if (command?.waits === 'local') {
        command.apply(draft, transaction.input as never);
      }
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
    for (const listener of changeListeners) {
      listener();
    }
  }

  /** Applies one change unless the record already holds a later one. */
  function applyChange(change: Change, syncId: number) {
    const key = recordKey(change.model, change.id);
    const known = meta.get(key);
    if (known && known.syncId > syncId) {
      return;
    }
    const table = tableOf(confirmed, change.model);
    if (change.action === 'delete' || change.data === null) {
      table.delete(change.id);
      meta.delete(key);
    } else {
      table.set(change.id, { ...change.data, id: change.id });
      meta.set(key, { groups: change.groups, syncId });
    }
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
    for (const [group, resolves] of waiters) {
      if (loaded.has(group)) {
        waiters.delete(group);
        for (const resolve of resolves) {
          resolve();
        }
      }
    }
  }

  function dropSettled() {
    pending = pending.filter(({ acceptedAt }) => acceptedAt === null || acceptedAt > lastSyncId);
  }

  return {
    get: <Row extends RecordRow>(model: Model<Row>, id: string) =>
      visible.get(model.name)?.get(id) as Row | undefined,
    ids(model, order, where) {
      const key = `${model.name}\u0000${order ? `${order.by}:${order.direction}` : ''}\u0000${where ? `${where.field}=${where.equals}` : ''}`;
      const cached = idLists.get(key);
      if (cached && !cached.stale) {
        return cached.ids;
      }
      const ids = sortedIds(
        visible.get(model.name),
        order as Order<RecordRow> | undefined,
        where as Where<RecordRow> | undefined,
      );
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
      const id = crypto.randomUUID();
      pending.push({
        transaction: { id, command: command.name, input },
        sent: false,
        acceptedAt: null,
      });
      recompute();
      for (const listener of pendingListeners) {
        listener();
      }
      return id;
    },
    isPending: (transactionId) =>
      pending.some(({ transaction }) => transaction.id === transactionId),
    lastSyncId: () => lastSyncId,
    load(state) {
      // A state saved before records had groups cannot be purged by group.
      // Start empty: the next connection loads everything again.
      if (!state.meta || !state.groups) {
        return;
      }
      meta = new Map(Object.entries(state.meta));
      loaded = new Set(state.groups);
      confirmed = new Map(
        Object.entries(state.tables).map(([name, rows]) => [
          name,
          new Map(rows.map((row) => [row.id, row])),
        ]),
      );
      ({ lastSyncId } = state);
      wakeLoaded();
      pending = state.pending.map((transaction) => ({
        transaction,
        sent: false,
        acceptedAt: null,
      }));
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
    loadGroup(group) {
      if (loaded.has(group)) {
        return Promise.resolve();
      }
      return new Promise((resolve) => {
        const resolves = waiters.get(group) ?? [];
        resolves.push(resolve);
        waiters.set(group, resolves);
        for (const listener of loadListeners) {
          listener(group);
        }
      });
    },
    requestedGroups: () => [...waiters.keys()],
    onLoadRequest(listener) {
      loadListeners.add(listener);
      return () => loadListeners.delete(listener);
    },
    resetConfirmed() {
      confirmed = new Map();
      meta = new Map();
      lastSyncId = 0;
      for (const entry of pending) {
        entry.sent = false;
        entry.acceptedAt = null;
      }
      recompute();
      for (const listener of pendingListeners) {
        listener();
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
            reason: outcome.reason ?? 'rejected',
          };
        } else {
          entry.acceptedAt = outcome.syncId;
        }
      }
      dropSettled();
      recompute();
      if (rejection !== before) {
        for (const listener of rejectionWatchers) {
          listener();
        }
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
