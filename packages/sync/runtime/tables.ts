import type { Draft, Model, Order, RecordRow, Where } from '@repo/sync/types/records';

/**
 * The plain data helpers of the object pool: tables of records, the draft a
 * local change writes to, and the change detection that keeps unchanged
 * records as the same objects.
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

export function draftOver(tables: Tables): Draft {
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
  order: Order<RecordRow> | undefined,
  where: Where<RecordRow> | undefined,
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

export const recordKey = (model: string, id: string) => `${model}\u0000${id}`;
