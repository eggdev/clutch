import type { Model, RecordRow } from '@repo/sync/types/records';

/** Defines one kind of record. The name is the model name in each change. */
export function defineModel<Row extends RecordRow>(name: string): Model<Row> {
  return { name };
}
