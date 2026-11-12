import type { Draft, Replayable } from '@repo/sync/contract/command';
import type { RecordRow } from '@repo/sync/contract/record';
import type { Change, Delta, Outcome } from '@repo/sync/types/protocol';

/** One pending transaction of the reference model, with the sync ID that accepted it. */
type Entry = {
  readonly transactionId: string;
  readonly command: string;
  readonly input: Readonly<Record<string, unknown>>;
  acceptedAt: number | null;
};

/** The confirmed records, by model name and then by record ID. */
type Tables = Map<string, Map<string, RecordRow>>;

/** The reference model of the object pool. Each read is computed from scratch. */
export type ReferencePool = {
  /** Queues a local run of a command, under the transaction ID the caller gives. */
  readonly run: (id: string, command: string, input: Readonly<Record<string, unknown>>) => void;
  readonly applyDeltas: (deltas: ReadonlyArray<Delta>) => void;
  readonly settle: (outcomes: ReadonlyArray<Outcome>) => void;
  readonly resetConfirmed: () => void;
  /**
   * The app starts again from its saved state. The saved state holds each
   * pending transaction, and not which ones the server accepted: the engine
   * sends each one again, and the server applies it once.
   */
  readonly reload: () => void;
  /** The record as the screen sees it: the confirmed records with each pending change applied. */
  readonly get: (modelName: string, id: string) => RecordRow | undefined;
  /** The record that the server confirmed, without the pending changes. */
  readonly confirmed: (modelName: string, id: string) => RecordRow | undefined;
  /** The IDs that the screen sees, sorted. */
  readonly ids: (modelName: string) => Array<string>;
  /** The transaction IDs in the queue, in order. */
  readonly pendingIds: () => Array<string>;
  readonly lastSyncId: () => number;
};

/**
 * A plain model of what the object pool shows. It keeps the confirmed records,
 * the last sync ID of each record, `lastSyncId` and the queue of pending
 * transactions. It has no cache and no watchers, so a test can compare the
 * real pool with it after each step.
 */
export function referencePool(changes: ReadonlyArray<Replayable>): ReferencePool {
  const byName = new Map(changes.map((change) => [change.name, change]));
  let confirmed: Tables = new Map();
  // The last sync ID of each record, by model and record ID. A delete keeps its sync ID.
  let syncIds = new Map<string, Map<string, number>>();
  let lastSync = 0;
  let queue: Array<Entry> = [];

  /** The confirmed records with each pending change applied again, in order. */
  function visible(): Tables {
    const tables: Tables = new Map([...confirmed].map(([name, table]) => [name, new Map(table)]));
    const draft: Draft = {
      get: (model, id) => {
        const row: unknown = tables.get(model.name)?.get(id);
        return model.is(row) ? row : undefined;
      },
      put: (model, row) => {
        const table = tables.get(model.name) ?? new Map<string, RecordRow>();
        table.set(row.id, row);
        tables.set(model.name, table);
      },
      remove: (model, id) => {
        tables.get(model.name)?.delete(id);
      },
    };
    for (const entry of queue) {
      byName.get(entry.command)?.replay(draft, entry.input);
    }
    return tables;
  }

  /** Applies one change unless the record already holds a later change. */
  function applyChange(change: Change, syncId: number): void {
    const known = syncIds.get(change.model)?.get(change.id);
    if (known !== undefined && known > syncId) {
      return;
    }
    const table = confirmed.get(change.model) ?? new Map<string, RecordRow>();
    confirmed.set(change.model, table);
    const sync = syncIds.get(change.model) ?? new Map<string, number>();
    syncIds.set(change.model, sync);
    sync.set(change.id, syncId);
    if (change.action === 'delete' || change.data === null) {
      table.delete(change.id);
    } else {
      table.set(change.id, { ...change.data, id: change.id });
    }
  }

  /** Removes each accepted transaction that the sync ID has reached. */
  function dropReached(): void {
    queue = queue.filter((entry) => entry.acceptedAt === null || entry.acceptedAt > lastSync);
  }

  return {
    run(id, command, input) {
      queue.push({ transactionId: id, command, input, acceptedAt: null });
    },
    applyDeltas(deltas) {
      for (const delta of deltas) {
        if (delta.syncId <= lastSync) {
          continue;
        }
        for (const change of delta.changes) {
          applyChange(change, delta.syncId);
        }
        lastSync = delta.syncId;
        queue = queue.filter((entry) => entry.transactionId !== delta.transactionId);
      }
      dropReached();
    },
    settle(outcomes) {
      for (const outcome of outcomes) {
        const entry = queue.find((item) => item.transactionId === outcome.transactionId);
        if (!entry) {
          continue;
        }
        if (outcome.status === 'rejected') {
          queue = queue.filter((item) => item !== entry);
        } else {
          entry.acceptedAt = outcome.syncId;
        }
      }
      dropReached();
    },
    resetConfirmed() {
      confirmed = new Map();
      syncIds = new Map();
      lastSync = 0;
      for (const entry of queue) {
        entry.acceptedAt = null;
      }
    },
    reload() {
      for (const entry of queue) {
        entry.acceptedAt = null;
      }
    },
    get: (modelName, id) => visible().get(modelName)?.get(id),
    confirmed: (modelName, id) => confirmed.get(modelName)?.get(id),
    ids: (modelName) => [...(visible().get(modelName)?.keys() ?? [])].toSorted(),
    pendingIds: () => queue.map((entry) => entry.transactionId),
    lastSyncId: () => lastSync,
  };
}
