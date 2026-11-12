import type { Model, RecordRow } from '@repo/sync/contract/record';

/** How a list of IDs is sorted: by one field, then by ID so the order is stable. */
export type Order<Row extends RecordRow> = {
  readonly by: keyof Row & string;
  readonly direction: 'asc' | 'desc';
};

/** Keeps only the records whose field has this value, such as the notes of one space. */
export type Where<Row extends RecordRow> = {
  readonly field: keyof Row & string;
  readonly equals: string;
};

/**
 * The pool that screens see. It has no way to write. Each watch wakes only
 * for its own part of the pool: a model, one record, or the last rejection.
 */
export type ReadablePool = {
  /** One record. The same object comes back until one of its fields changes. */
  readonly get: <Row extends RecordRow>(model: Model<Row>, id: string) => Row | undefined;
  /** The IDs of a model. The same array comes back until the IDs or their order change. */
  readonly ids: <Row extends RecordRow>(
    model: Model<Row>,
    order?: Order<Row>,
    where?: Where<Row>,
  ) => ReadonlyArray<string>;
  /** Wakes when a record of the model is added, removed or changed. */
  readonly watchModel: <Row extends RecordRow>(
    model: Model<Row>,
    listener: () => void,
  ) => () => void;
  /** Wakes when this one record is added, removed or changed. */
  readonly watchRecord: <Row extends RecordRow>(
    model: Model<Row>,
    id: string,
    listener: () => void,
  ) => () => void;
  /** The last rejected transaction, with its code and reason, for the screen that sent it. */
  readonly lastRejection: () => Rejection | undefined;
  readonly watchRejection: (listener: () => void) => () => void;
};

/**
 * Why the server refused a transaction. `code` is stable: it is a refusal
 * that the command declares, or a built-in one. Code branches on it. `reason`
 * is the sentence that the screen shows.
 */
export type Rejection = {
  readonly transactionId: string;
  readonly command: string;
  readonly code: string;
  readonly reason: string;
};
