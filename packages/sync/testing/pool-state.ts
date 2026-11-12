import { command } from '@repo/sync/contract/command';
import type { Waits } from '@repo/sync/contract/command';
import { organizationGroup } from '@repo/sync/contract/engine-groups';
import type { Fields, Stamps } from '@repo/sync/contract/fields';
import { record } from '@repo/sync/contract/record';
import type { RecordDeclaration, RecordFields, RecordRow } from '@repo/sync/contract/record';
import type { PoolState } from '@repo/sync/types/local-database';
import type { Transaction } from '@repo/sync/types/protocol';

/** The one sync group of test records, unless a test names others: the group of the organization `test`. */
export const testGroup = organizationGroup.of('test');

/** A record declaration whose records are all in `testGroup`. */
export function testModel<const Name extends string, const F extends RecordFields>(
  name: Name,
  fields: F,
): RecordDeclaration<Name, F> {
  return record(name, { fields, groups: [organizationGroup.ofScope] });
}

/**
 * A command declaration for a test of the object pool: any actor of the
 * organization may run it, it declares no refusal, and it offers no tool.
 */
export function testCommand<
  const Name extends string,
  const F extends Fields,
  const W extends Waits,
>(name: Name, input: F, waits: W) {
  return command(name, { input, waits, access: 'organization', refuses: [], tool: 'none' });
}

/**
 * Stamps that give the same values on each run: the IDs `id-1`, `id-2` and so
 * on, and one fixed time. A test passes them as `options.stamps` to `createPool`.
 */
export function testStamps(now = '2026-01-01T00:00:00.000Z'): Stamps {
  let count = 0;
  return {
    newId: () => {
      count += 1;
      return `id-${count}`;
    },
    now: () => now,
  };
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
