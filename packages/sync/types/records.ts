/** One record in the object pool. Its fields are plain JSON, as the server sent them. */
export type RecordRow = { readonly id: string } & Readonly<Record<string, unknown>>;

/** The definition of one kind of record. Screens read records of a model from the pool. */
export type Model<Row extends RecordRow> = {
  readonly name: string;
  /** Only for types. A model holds no rows. */
  readonly row?: Row;
};

/** How a list of IDs is sorted: by one field, then by ID so the order is stable. */
export type Order<Row extends RecordRow> = {
  readonly by: keyof Row & string;
  readonly direction: 'asc' | 'desc';
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
  ) => ReadonlyArray<string>;
  /** Wakes when a record of the model is added, removed or changed. */
  readonly watchModel: (model: Model<RecordRow>, listener: () => void) => () => void;
  /** Wakes when this one record is added, removed or changed. */
  readonly watchRecord: (model: Model<RecordRow>, id: string, listener: () => void) => () => void;
  /** The last rejected transaction and its reason, for the screen that sent it. */
  readonly lastRejection: () => Rejection | undefined;
  readonly watchRejection: (listener: () => void) => () => void;
};

/** The writable view that only a command's local change receives. */
export type Draft = {
  readonly get: <Row extends RecordRow>(model: Model<Row>, id: string) => Row | undefined;
  readonly put: <Row extends RecordRow>(model: Model<Row>, row: Row) => void;
  readonly remove: <Row extends RecordRow>(model: Model<Row>, id: string) => void;
};

export type Rejection = { readonly transactionId: string; readonly reason: string };

/** Whether the screen shows a command as done at once, or after the server confirms it. */
type Waits = 'local' | 'server';

/** One command: its name, its local change and whether it waits for the server. */
export type Command<Input> = {
  readonly name: string;
  readonly waits: Waits;
  readonly apply: (draft: Draft, input: Input) => void;
};
