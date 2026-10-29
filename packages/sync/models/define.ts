import { matches } from '@repo/sync/models/shape';
import type { Shape } from '@repo/sync/models/shape';
import type { GroupScope, Load, Model, RecordRow } from '@repo/sync/types/records';

/**
 * Defines one kind of record. The name is the model name in each change.
 * `fields` gives the JSON kind of each field, and the compiler checks it
 * against the record type. `groupsOf` names the sync groups of a record, such
 * as `space:<id>`.
 */
export function defineModel<Row extends RecordRow>(
  name: string,
  options: {
    readonly fields: Shape<Row>;
    readonly groupsOf: (record: Row, scope: GroupScope) => ReadonlyArray<string>;
  },
): Model<Row> {
  return {
    name,
    groupsOf: (record, scope) => options.groupsOf(record, scope),
    is: (record): record is Row => matches(options.fields, record),
  };
}

/**
 * Defines a load function for a model: the group that holds the records a
 * screen asks for. A gate passes the group to the sync engine and waits.
 */
export function defineLoad<Row extends RecordRow, Args extends ReadonlyArray<unknown>>(
  model: Model<Row>,
  group: (...args: Args) => string,
): Load<Args> {
  return { model: model.name, group };
}

/** The built-in group of an organization. Every actor in it loads it. */
export const organizationGroup = (organizationId: string) => `org:${organizationId}`;

/** The built-in group of one user. Only that user loads it. */
export const userGroup = (userId: string) => `user:${userId}`;
