/** One record in the object pool. Its fields are plain JSON, as the server sent them. */
export type RecordRow = { readonly id: string } & Readonly<Record<string, unknown>>;

/** The definition of one kind of record. Screens read records of a model from the pool. */
export type Model<Row extends RecordRow> = {
  readonly name: string;
  /** Only for types. A model holds no rows. */
  readonly row?: Row;
};

/** The pool that screens see. It has no way to write. */
export type ReadablePool = {
  readonly subscribe: (listener: () => void) => () => void;
  readonly version: () => number;
  readonly all: <Row extends RecordRow>(model: Model<Row>) => ReadonlyArray<Row>;
  readonly get: <Row extends RecordRow>(model: Model<Row>, id: string) => Row | undefined;
  /** The last rejected transaction and its reason, for the screen that sent it. */
  readonly lastRejection: () => Rejection | undefined;
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
