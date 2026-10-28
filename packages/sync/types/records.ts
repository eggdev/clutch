/** One record in the object pool. Its fields are plain JSON, as the server sent them. */
export type RecordRow = { readonly id: string } & Readonly<Record<string, unknown>>;

/** What `groupsOf` may read besides the record: the organization that owns it. */
export type GroupScope = { readonly organizationId: string };

/**
 * The definition of one kind of record. Screens read records of a model from
 * the pool. `groupsOf` names the sync groups of a record: a client gets the
 * record only when it has loaded one of them.
 */
export type Model<Row extends RecordRow> = {
  readonly name: string;
  readonly groupsOf: (record: Row, scope: GroupScope) => ReadonlyArray<string>;
  /** Only for types. A model holds no rows. */
  readonly row?: Row;
};

/**
 * A load function: how a screen asks for the records of one group, such as
 * the notes of one space. A gate calls it before it navigates.
 */
export type Load<Args extends ReadonlyArray<unknown>> = {
  readonly model: string;
  readonly group: (...args: Args) => string;
};

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

/**
 * One command: its name, whether it waits for the server, and its local
 * change. A command that waits for the server shows nothing until its delta
 * arrives, so it needs no local change.
 */
export type Command<Input> =
  | {
      readonly name: string;
      readonly waits: 'local';
      readonly apply: (draft: Draft, input: Input) => void;
    }
  | {
      readonly name: string;
      readonly waits: 'server';
      readonly apply?: (draft: Draft, input: Input) => void;
    };
