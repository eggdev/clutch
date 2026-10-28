import type { PoolState } from '@repo/sync/types/local-database';
import type { Delta, Outcome, Transaction } from '@repo/sync/types/protocol';
import type {
  Command,
  Draft,
  Model,
  Order,
  ReadablePool,
  RecordRow,
  Rejection,
} from '@repo/sync/types/records';

type Table = Map<string, RecordRow>;
type Tables = Map<string, Table>;
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
  readonly resetConfirmed: () => void;
  readonly settle: (outcomes: ReadonlyArray<Outcome>) => void;
  readonly onPending: (listener: () => void) => () => void;
  /** Wakes after every change to the pool, so the engine can save it. Screens never use it. */
  readonly onChange: (listener: () => void) => () => void;
};

function copy(tables: Tables): Tables {
  return new Map([...tables].map(([name, table]) => [name, new Map(table)]));
}

function tableOf(tables: Tables, name: string): Table {
  let table = tables.get(name);
  if (!table) {
    table = new Map();
    tables.set(name, table);
  }
  return table;
}

function draftOver(tables: Tables): Draft {
  return {
    get: <Row extends RecordRow>(model: Model<Row>, id: string) =>
      tables.get(model.name)?.get(id) as Row | undefined,
    put: (model, row) => {
      tableOf(tables, model.name).set(row.id, row);
    },
    remove: (model, id) => {
      tables.get(model.name)?.delete(id);
    },
  };
}

/** Whether two JSON values hold the same data. Records hold only JSON, as the server sent it. */
function sameJson(a: unknown, b: unknown): boolean {
  if (Object.is(a, b)) {
    return true;
  }
  if (Array.isArray(a) && Array.isArray(b)) {
    return a.length === b.length && a.every((item, index) => sameJson(item, b[index]));
  }
  if (a && b && typeof a === 'object' && typeof b === 'object') {
    const aKeys = Object.keys(a);
    return (
      aKeys.length === Object.keys(b).length &&
      aKeys.every((key) => sameJson(Reflect.get(a, key), Reflect.get(b, key)))
    );
  }
  return false;
}

/**
 * Puts each record of `before` that did not change back into `after`, so it
 * stays the same object. Returns each model and record ID that did change.
 */
function keepUnchanged(before: Tables, after: Tables): Array<[model: string, id: string]> {
  const changed: Array<[model: string, id: string]> = [];
  for (const name of new Set([...before.keys(), ...after.keys()])) {
    const old = before.get(name) ?? new Map<string, RecordRow>();
    const next = after.get(name) ?? new Map<string, RecordRow>();
    for (const [id, row] of next) {
      const previous = old.get(id);
      if (previous && sameJson(previous, row)) {
        next.set(id, previous);
      } else {
        changed.push([name, id]);
      }
    }
    for (const id of old.keys()) {
      if (!next.has(id)) {
        changed.push([name, id]);
      }
    }
  }
  return changed;
}

/** Sorts IDs by one field of their records, then by ID. */
function sortedIds(table: Table | undefined, order: Order<RecordRow> | undefined): Array<string> {
  const rows = [...(table?.values() ?? [])];
  const sign = order?.direction === 'desc' ? -1 : 1;
  const key = (row: RecordRow) => String(order ? row[order.by] : '');
  rows.sort((a, b) => sign * key(a).localeCompare(key(b)) || a.id.localeCompare(b.id));
  return rows.map((row) => row.id);
}

/** A set of listeners for each key, so a change wakes only its own listeners. */
function listenerMap() {
  const map = new Map<string, Set<() => void>>();
  return {
    add(key: string, listener: () => void) {
      let set = map.get(key);
      if (!set) {
        set = new Set();
        map.set(key, set);
      }
      set.add(listener);
      return () => {
        set.delete(listener);
        if (!set.size) {
          map.delete(key);
        }
      };
    },
    wake(key: string) {
      for (const listener of map.get(key) ?? []) {
        listener();
      }
    },
  };
}

const recordKey = (model: string, id: string) => `${model}\u0000${id}`;

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

  function dropSettled() {
    pending = pending.filter(({ acceptedAt }) => acceptedAt === null || acceptedAt > lastSyncId);
  }

  return {
    get: <Row extends RecordRow>(model: Model<Row>, id: string) =>
      visible.get(model.name)?.get(id) as Row | undefined,
    ids(model, order) {
      const key = `${model.name}\u0000${order ? `${order.by}:${order.direction}` : ''}`;
      const cached = idLists.get(key);
      if (cached && !cached.stale) {
        return cached.ids;
      }
      const ids = sortedIds(visible.get(model.name), order as Order<RecordRow> | undefined);
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
      confirmed = new Map(
        Object.entries(state.tables).map(([name, rows]) => [
          name,
          new Map(rows.map((row) => [row.id, row])),
        ]),
      );
      ({ lastSyncId } = state);
      pending = state.pending.map((transaction) => ({
        transaction,
        sent: false,
        acceptedAt: null,
      }));
      recompute();
    },
    snapshot: () => ({
      lastSyncId,
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
          const table = tableOf(confirmed, change.model);
          if (change.action === 'delete' || change.data === null) {
            table.delete(change.id);
          } else {
            table.set(change.id, { ...change.data, id: change.id });
          }
        }
        lastSyncId = delta.syncId;
        pending = pending.filter(({ transaction }) => transaction.id !== delta.transactionId);
      }
      dropSettled();
      recompute();
    },
    resetConfirmed() {
      confirmed = new Map();
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
