import type { Change } from '@repo/sync/types/protocol';
import type { GroupScope, Model, RecordRow } from '@repo/sync/types/records';

/** The change that writes a record, with the sync groups that its model names. */
export function upsertChange<Row extends RecordRow>(
  model: Model<Row>,
  record: Row,
  scope: GroupScope,
): Change {
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
): Change {
  return {
    model: model.name,
    id: record.id,
    action: 'delete',
    data: record,
    groups: model.groupsOf(record, scope),
  };
}
