import type { Draft } from '@repo/sync/contract/command';
import type { Model, RecordRow } from '@repo/sync/contract/record';
import type { WaitingRow } from '@repo/sync/types/local-database';
import type { Outcome, SyncActor, Transaction } from '@repo/sync/types/protocol';
import type { ReadablePool, Rejection } from '@repo/sync/types/records';

/**
 * The plain data helpers of the object pool: tables of records, the draft a
 * local change writes to, the visible tables that keep unchanged records as
 * the same objects, the waits of the gates for a group, and the waiting
 * transactions with the outcomes of a push. They share one module, because
 * each module of the pool loads before the first paint.
 */
type Table = Map<string, RecordRow>;
export type Tables = Map<string, Table>;

/**
 * What the waiting changes wrote over the confirmed records, by model and ID.
 * `null` is a record that a waiting change removed.
 */
export type Writes = Map<string, Map<string, RecordRow | null>>;

export function tableOf<Row>(tables: Map<string, Map<string, Row>>, name: string) {
  let table = tables.get(name);
  if (!table) {
    table = new Map<string, Row>();
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
function readAs<Row extends RecordRow>(
  model: Model<Row>,
  tables: Tables,
  id: string,
): Row | undefined {
  const record: unknown = tables.get(model.name)?.get(id);
  return model.is(record) ? record : undefined;
}

/** The record that screens see: the write of a waiting change, or else the confirmed record. */
function seen(base: Tables, writes: Writes, model: string, id: string): RecordRow | undefined {
  const written = writes.get(model);
  return written?.has(id) ? (written.get(id) ?? undefined) : base.get(model)?.get(id);
}

/** The draft that a waiting change writes to: it reads `base` under `writes`, and writes only `writes`. */
export function draftOver(base: Tables, writes: Writes): Draft {
  return {
    get<Row extends RecordRow>(model: Model<Row>, id: string) {
      const record: unknown = seen(base, writes, model.name, id);
      return model.is(record) ? record : undefined;
    },
    put: (model, row) => {
      tableOf(writes, model.name).set(row.id, row);
    },
    remove: (model, id) => {
      tableOf(writes, model.name).set(id, null);
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

/** Sorts IDs by one field of their records, then by ID. `where` keeps only matching records. */
function sortedIds(
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

/** Calls each listener once. */
export function wake(listeners: Iterable<() => void>): void {
  for (const listener of listeners) {
    listener();
  }
}

export const recordKey = (model: string, id: string) => `${model}\u0000${id}`;

/** What a screen reads from the pool, and how it watches it. */
type Reads = Pick<ReadablePool, 'get' | 'ids' | 'watchModel' | 'watchRecord'>;

/** The key of each record of `tables`. */
function keysOf(tables: Map<string, Map<string, unknown>>): Array<string> {
  return [...tables].flatMap(([model, table]) =>
    [...table.keys()].map((id) => recordKey(model, id)),
  );
}

/**
 * The tables that screens see, with their ID lists and watchers. `show` puts
 * them in step with the confirmed records and the writes of the waiting
 * changes. It visits only the records that `touched` names and the records
 * that the waiting changes wrote, now or the time before, and returns how
 * many it visited. Each record that did not change stays the same object, and
 * only the watchers of the records and models that changed wake. An ID list
 * is built again only after its model changed, and the old array is kept
 * when the IDs match, so a screen that reads it does not render again.
 */
export function visibleTables(): Reads & {
  readonly show: (base: Tables, writes: Writes, touched: ReadonlySet<string> | 'all') => number;
} {
  const visible: Tables = new Map();
  let lastWrites: Writes = new Map();
  const lists = new Map<string, { ids: ReadonlyArray<string>; changed: boolean }>();
  const modelWatchers = listenerMap();
  const recordWatchers = listenerMap();
  return {
    show(base, writes, touched) {
      const keys = new Set(touched === 'all' ? [...keysOf(visible), ...keysOf(base)] : touched);
      for (const key of [...keysOf(lastWrites), ...keysOf(writes)]) {
        keys.add(key);
      }
      lastWrites = writes;
      const changed: Array<string> = [];
      const models = new Set<string>();
      for (const key of keys) {
        const [model = '', id = ''] = key.split('\u0000');
        const before = visible.get(model)?.get(id);
        const next = seen(base, writes, model, id);
        if (before === next || (before && next && sameJson(before, next))) {
          continue;
        }
        if (next) {
          tableOf(visible, model).set(id, next);
        } else {
          visible.get(model)?.delete(id);
        }
        models.add(model);
        changed.push(key);
      }
      for (const [key, list] of lists) {
        list.changed ||= models.has(key.slice(0, key.indexOf('\u0000')));
      }
      for (const key of changed) {
        recordWatchers.wake(key);
      }
      for (const name of models) {
        modelWatchers.wake(name);
      }
      return keys.size;
    },
    get: (model, id) => readAs(model, visible, id),
    ids(model, order, where) {
      const key = `${model.name}\u0000${order ? `${order.by}:${order.direction}` : ''}\u0000${where ? `${where.field}=${where.equals}` : ''}`;
      const known = lists.get(key);
      if (known && !known.changed) {
        return known.ids;
      }
      const ids = sortedIds(visible.get(model.name), order, where);
      const kept = known && sameJson(known.ids, ids) ? known.ids : ids;
      lists.set(key, { ids: kept, changed: false });
      return kept;
    },
    watchModel: (model, listener) => modelWatchers.add(model.name, listener),
    watchRecord: (model, id, listener) => recordWatchers.add(recordKey(model.name, id), listener),
  };
}

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
  /**
   * Wakes when a gate asks for a group. Only the engine uses it, for the
   * length of one pull. The leave returns `true` when the last listener left.
   */
  readonly onRequest: (listener: (group: string) => void) => () => boolean;
  /** Each group whose pages came and that did not load stops loading. It returns `true` when there was one. */
  readonly cutOff: () => boolean;
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
      return () => listeners.delete(listener) && listeners.size === 0;
    },
    cutOff() {
      const any = paged.size > 0;
      paged.clear();
      return any;
    },
  };
}

/** A waiting transaction, with the sync ID of the event that accepted it, if one did. */
type Waiting = { readonly transaction: Transaction; acceptedAt: number | null };

/** A waiting transaction of the pool, with the actor that ran it if the pool knew it. */
export type Pending = Waiting & { actor: SyncActor | undefined; sent: boolean };

/** The saved row of a waiting transaction, with its actor when it has one. */
export const rowOf = ({ transaction, actor }: Pending): WaitingRow =>
  actor ? { ...transaction, actor } : transaction;

/** Whether two actors are the same user in the same organization. */
export function sameActor(a: SyncActor, b: SyncActor): boolean {
  return a.userId === b.userId && a.organizationId === b.organizationId;
}

/**
 * The waiting transactions that `actor` may send: each one of another actor
 * is left out, and each one with no actor takes this one.
 */
export function keepActor(pending: ReadonlyArray<Pending>, actor: SyncActor): Array<Pending> {
  const kept = pending.filter((entry) => !entry.actor || sameActor(entry.actor, actor));
  for (const entry of kept) {
    entry.actor = actor;
  }
  return kept;
}

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
