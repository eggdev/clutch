import type { GroupScope } from '@repo/sync/contract/groups';
import type { Model, RecordRow } from '@repo/sync/contract/record';

/**
 * One record that a server change wrote or deleted, with its sync groups. It
 * has the shape of a change in the sync protocol of the engine.
 */
export type RecordChange = {
  readonly model: string;
  readonly id: string;
  readonly action: 'upsert' | 'delete';
  readonly data: Readonly<Record<string, unknown>> | null;
  readonly groups: ReadonlyArray<string>;
};

/**
 * A record is a closed shape when it leaves the server. A type lets a row
 * with more keys pass, such as a spread of a table row, so the check is here.
 */
function refuseUndeclared<Row extends RecordRow>(model: Model<Row>, record: Row): void {
  const extra = model.undeclared(record);
  if (extra.length > 0) {
    throw new Error(
      `The ${model.name} record ${record.id} carries ${extra.join(', ')}, which its contract does not declare. A field that no contract declares never leaves the server. Build the record from its declared fields.`,
    );
  }
}

/**
 * The change that writes a record, with the sync groups that its declaration
 * names. The record is checked against its fields here, so a mistake stops
 * the server change where it is built. The event log is the door that every
 * change passes, and it checks each change again before a client gets it.
 * A type cannot hold a limit such as `text({ max })`, so the check keeps it.
 */
export function upsertChange<Row extends RecordRow>(
  model: Model<Row>,
  record: Row,
  scope: GroupScope,
): RecordChange {
  // The type already says that the record fits, so the check is kept as a
  // plain yes or no, and the compiler does not rule the failure out.
  const fits: boolean = model.is(record);
  if (!fits) {
    throw new Error(
      `The ${model.name} record ${record.id} does not match the fields that its contract declares. Fix the server change that wrote it, or the record.`,
    );
  }
  refuseUndeclared(model, record);
  return {
    model: model.name,
    id: record.id,
    action: 'upsert',
    data: record,
    groups: model.groupsOf(record, scope),
  };
}

/**
 * The change that deletes a record. It carries the last data of the record,
 * so the server knows its groups and each client that holds it gets the delete.
 */
export function deleteChange<Row extends RecordRow>(
  model: Model<Row>,
  record: Row,
  scope: GroupScope,
): RecordChange {
  refuseUndeclared(model, record);
  return {
    model: model.name,
    id: record.id,
    action: 'delete',
    data: record,
    groups: model.groupsOf(record, scope),
  };
}
