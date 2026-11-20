import type { Draft } from '@repo/sync/contract/command';
import type { Model, RecordRow } from '@repo/sync/contract/record';
import type { Outcome, Transaction } from '@repo/sync/types/protocol';
import type { Rejection } from '@repo/sync/types/records';

/**
 * The plain data helpers of the object pool: tables of records, the draft a
 * local change writes to, the change detection that keeps unchanged records
 * as the same objects, the waits of the gates for a group, and the outcomes
 * of a push. They share
 * one module, because each module of the pool loads before the first paint.
 */
export type Table = Map<string, RecordRow>;
export type Tables = Map<string, Table>;

export function copy(tables: Tables): Tables {
  return new Map([...tables].map(([name, table]) => [name, new Map(table)]));
}

export function tableOf(tables: Tables, name: string): Table {
  let table = tables.get(name);
  if (!table) {
    table = new Map();
    tables.set(name, table);
  }
  return table;
}

/** The sort of an ID list, by one field name. */
type SortBy = { readonly by: string; readonly direction: 'asc' | 'desc' };
/** The filter of an ID list: one field and the value it must equal. */
type FilterBy = { readonly field: string; readonly equals: string };

/**
 * One record of a model, read with its type. The type guard is the only check:
 * the doors of the pool check each record when it enters, so a stored record
 * always fits its model, and a missing one reads as undefined.
 */
export function readAs<Row extends RecordRow>(
  model: Model<Row>,
  tables: Tables,
  id: string,
): Row | undefined {
  const record: unknown = tables.get(model.name)?.get(id);
  return model.is(record) ? record : undefined;
}

export function draftOver(tables: Tables): Draft {
  return {
    get: <Row extends RecordRow>(model: Model<Row>, id: string) => readAs(model, tables, id),
    put: (model, row) => {
      tableOf(tables, model.name).set(row.id, row);
    },
    remove: (model, id) => {
      tables.get(model.name)?.delete(id);
    },
  };
}

/** Whether two JSON values hold the same data. Records hold only JSON, as the server sent it. */
export function sameJson(a: unknown, b: unknown): boolean {
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
export function keepUnchanged(before: Tables, after: Tables): Array<[model: string, id: string]> {
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

/** Sorts IDs by one field of their records, then by ID. `where` keeps only matching records. */
export function sortedIds(
  table: Table | undefined,
  order: SortBy | undefined,
  where: FilterBy | undefined,
): Array<string> {
  const rows = [...(table?.values() ?? [])].filter(
    (row) => !where || row[where.field] === where.equals,
  );
  const sign = order?.direction === 'desc' ? -1 : 1;
  const key = (row: RecordRow) => String(order ? row[order.by] : '');
  rows.sort((a, b) => sign * key(a).localeCompare(key(b)) || a.id.localeCompare(b.id));
  return rows.map((row) => row.id);
}

/** A set of listeners for each key, so a change wakes only its own listeners. */
export function listenerMap() {
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

/** Calls each listener once. */
export function wake(listeners: Iterable<() => void>): void {
  for (const listener of listeners) {
    listener();
  }
}

export const recordKey = (model: string, id: string) => `${model}\u0000${id}`;

/**
 * The gates that wait for a group, and the groups that the engine still has
 * to ask the server for. A wait ends in one of two ways: the group is loaded,
 * or the server refuses it. A group whose backfill comes in pages loads from
 * its first page until that end.
 */
export type GroupWaits = {
  /** Waits for a group and wakes the engine. `true` means loaded, `false` means refused. */
  readonly wait: (group: string) => Promise<boolean>;
  /** Keeps a group asked for with no gate that waits, so the engine asks for it again. */
  readonly keep: (group: string) => void;
  /** Ends, as loaded, each wait whose group is loaded now. */
  readonly wake: (isLoaded: (group: string) => boolean) => void;
  /** Ends, as refused, each wait for one group, and forgets the request. */
  readonly refuse: (group: string) => void;
  /** The groups asked for and not loaded yet. */
  readonly requested: () => ReadonlyArray<string>;
  /** Notes that a page of the backfill of a group came. */
  readonly paged: (group: string) => void;
  /** The groups whose pages came, and that are not loaded or refused yet. */
  readonly loading: () => ReadonlySet<string>;
  /** Wakes when a gate asks for a group. Only the engine uses it. */
  readonly onRequest: (listener: (group: string) => void) => () => void;
};

export function groupWaits(): GroupWaits {
  const waiters = new Map<string, Array<(loaded: boolean) => void>>();
  const listeners = new Set<(group: string) => void>();
  const paged = new Set<string>();

  function end(group: string, loaded: boolean) {
    const resolves = waiters.get(group) ?? [];
    waiters.delete(group);
    paged.delete(group);
    for (const resolve of resolves) {
      resolve(loaded);
    }
  }

  return {
    wait: (group) =>
      new Promise((resolve) => {
        waiters.set(group, [...(waiters.get(group) ?? []), resolve]);
        for (const listener of listeners) {
          listener(group);
        }
      }),
    keep(group) {
      waiters.set(group, waiters.get(group) ?? []);
    },
    wake(isLoaded) {
      for (const group of new Set([...waiters.keys(), ...paged].filter(isLoaded))) {
        end(group, true);
      }
    },
    refuse: (group) => end(group, false),
    requested: () => [...waiters.keys()],
    paged: (group) => paged.add(group),
    loading: () => paged,
    onRequest(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
  };
}

/** A waiting transaction, with the sync ID of the event that accepted it, if one did. */
type Waiting = { readonly transaction: Transaction; acceptedAt: number | null };

/**
 * The waiting transactions after the outcomes of one push, and the last
 * refusal. A rejected transaction leaves the queue and becomes the refusal.
 * An accepted one stays, with its sync ID, until its delta arrives. An
 * outcome of a transaction that is not waiting changes nothing.
 */
export function applyOutcomes<W extends Waiting>(
  pending: ReadonlyArray<W>,
  outcomes: ReadonlyArray<Outcome>,
  rejection: Rejection | undefined,
): { readonly pending: Array<W>; readonly rejection: Rejection | undefined } {
  let left = [...pending];
  let last = rejection;
  for (const outcome of outcomes) {
    const entry = left.find(({ transaction }) => transaction.id === outcome.transactionId);
    if (!entry) {
      continue;
    }
    if (outcome.status === 'rejected') {
      left = left.filter((item) => item !== entry);
      last = {
        transactionId: outcome.transactionId,
        command: entry.transaction.command,
        code: outcome.code ?? 'failed',
        reason: outcome.reason ?? 'rejected',
      };
    } else {
      entry.acceptedAt = outcome.syncId;
    }
  }
  return { pending: left, rejection: last };
}
