import type { PoolState } from '@repo/sync/types/local-database';
import type { Delta, Outcome, Transaction } from '@repo/sync/types/protocol';
import type {
  Command,
  Draft,
  Model,
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

/**
 * Creates the object pool. Confirmed records come only from server deltas.
 * What screens see is the confirmed records with each pending local change
 * applied again on top, so a delta rebases pending work and a rejection rolls
 * it back. `commands` lists every command, so a pending transaction loaded
 * from the local database can run its local change again.
 */
export function createPool(commands: ReadonlyArray<Command<never>>): Pool {
  const byName = new Map(commands.map((command) => [command.name, command]));
  let confirmed: Tables = new Map();
  let visible: Tables = new Map();
  let pending: Array<Pending> = [];
  let lastSyncId = 0;
  let version = 0;
  let rejection: Rejection | undefined;
  // One array for each model until the next change, so a snapshot read in
  // `useSyncExternalStore` stays the same object between changes.
  let lists = new Map<string, ReadonlyArray<RecordRow>>();
  const listeners = new Set<() => void>();
  const pendingListeners = new Set<() => void>();

  function recompute() {
    visible = copy(confirmed);
    const draft = draftOver(visible);
    for (const { transaction } of pending) {
      const command = byName.get(transaction.command);
      if (command?.waits === 'local') {
        command.apply(draft, transaction.input as never);
      }
    }
    lists = new Map();
    version += 1;
    for (const listener of listeners) {
      listener();
    }
  }

  function dropSettled() {
    pending = pending.filter(({ acceptedAt }) => acceptedAt === null || acceptedAt > lastSyncId);
  }

  return {
    subscribe(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    version: () => version,
    all: <Row extends RecordRow>(model: Model<Row>) => {
      let rows = lists.get(model.name);
      if (!rows) {
        rows = [...(visible.get(model.name)?.values() ?? [])];
        lists.set(model.name, rows);
      }
      return rows as Array<Row>;
    },
    get: <Row extends RecordRow>(model: Model<Row>, id: string) =>
      visible.get(model.name)?.get(id) as Row | undefined,
    lastRejection: () => rejection,
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
    },
    onPending(listener) {
      pendingListeners.add(listener);
      return () => pendingListeners.delete(listener);
    },
  };
}
