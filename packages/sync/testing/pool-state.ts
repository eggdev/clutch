import { defineModel } from '@repo/sync/models/define';
import type { PoolState } from '@repo/sync/types/local-database';
import type { Transaction } from '@repo/sync/types/protocol';
import type { Model, RecordRow } from '@repo/sync/types/records';

/** The one sync group of test records, unless a test names others. */
export const testGroup = 'org:test';

/** A model whose records are all in `testGroup`. */
export function testModel<Row extends RecordRow>(name: string): Model<Row> {
  return defineModel<Row>(name, { groupsOf: () => [testGroup] });
}

/**
 * A saved pool state, as the local database keeps it. Each record is in
 * `groups`, which the client has loaded, at the last sync ID.
 */
export function poolState(input: {
  readonly lastSyncId: number;
  readonly tables: Readonly<Record<string, ReadonlyArray<RecordRow>>>;
  readonly pending?: ReadonlyArray<Transaction>;
  readonly groups?: ReadonlyArray<string>;
}): PoolState {
  const groups = input.groups ?? [testGroup];
  return {
    lastSyncId: input.lastSyncId,
    tables: input.tables,
    groups,
    meta: Object.fromEntries(
      Object.entries(input.tables).flatMap(([model, rows]) =>
        rows.map((row) => [`${model}\u0000${row.id}`, { groups, syncId: input.lastSyncId }]),
      ),
    ),
    pending: input.pending ?? [],
  };
}
