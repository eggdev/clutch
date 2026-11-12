/**
 * The field vocabulary of a contract. A record and a command input name each
 * field and its kind. The kinds are plain data, so the client reads them with
 * no Effect code and the server reads the same object. `matches` is the one
 * check of a value against its fields, on both sides.
 */

/** A kind with no parts. `array` is a list and `object` a plain object, of any contents. */
type Scalar = 'string' | 'number' | 'integer' | 'boolean' | 'array' | 'object';

/** A scalar that also allows null and a missing field. */
type OptionalScalar = `${Scalar}?`;

/** A string with a longest and a shortest length. `text` makes one. */
export type TextField = { readonly kind: 'string'; readonly max: number; readonly min?: number };

/** A string that is one of a fixed set of values, such as a status. `oneOf` makes one. */
export type EnumField<Value extends string = string> = {
  readonly kind: 'enum';
  readonly values: ReadonlyArray<Value>;
};

/** A list whose items all have one kind. `list` makes one. */
export type ListField<Of = unknown> = { readonly kind: 'list'; readonly of: Of };

/** A plain object with its own fields. `shape` makes one. */
export type ShapeField<F = unknown> = { readonly kind: 'shape'; readonly fields: F };

/** A kind that also allows null and a missing field. `optional` makes one. */
export type OptionalField<Of = unknown> = { readonly kind: 'optional'; readonly of: Of };

/**
 * The kind of one field of a record. `json` allows any JSON value. The last
 * three are what `list`, `shape` and `optional` make: they hold kinds in turn.
 */
export type RecordField =
  | Scalar
  | OptionalScalar
  | 'json'
  | TextField
  | EnumField
  | { readonly kind: 'list'; readonly of: RecordField }
  | { readonly kind: 'shape'; readonly fields: Readonly<Record<string, RecordField>> }
  | { readonly kind: 'optional'; readonly of: RecordField };

/**
 * The kind of one field of a command input. `new-id` and `now` are stamps:
 * the object pool fills them when the command runs, and saves them with the
 * transaction. A screen never makes an ID or reads the clock.
 */
export type InputField = RecordField | 'new-id' | 'now';

/** The fields of a record or of a command input, by name. */
export type Fields = Readonly<Record<string, InputField>>;

type StampKind = 'new-id' | 'now';
type CanBeMissing = OptionalScalar | OptionalField;

/**
 * The TypeScript type of a value of one kind. A kind that is not one literal
 * kind, such as the kind of "any field", gives `unknown`. That also ends the
 * walk into a list or a shape of any kind.
 */
type ValueOf<Kind> = [RecordField] extends [Kind]
  ? unknown
  : Kind extends 'string' | StampKind | TextField
    ? string
    : Kind extends 'number' | 'integer'
      ? number
      : Kind extends 'boolean'
        ? boolean
        : Kind extends 'array'
          ? ReadonlyArray<unknown>
          : Kind extends 'object'
            ? Readonly<Record<string, unknown>>
            : Kind extends `${infer Base extends Scalar}?`
              ? ValueOf<Base> | null
              : Kind extends EnumField<infer Value>
                ? Value
                : Kind extends ListField<infer Of>
                  ? ReadonlyArray<ValueOf<Of>>
                  : Kind extends ShapeField<infer F>
                    ? Shaped<F, CanBeMissing>
                    : Kind extends OptionalField<infer Of>
                      ? ValueOf<Of> | null
                      : unknown;

type KeysOf<F, Kind> = { [Key in keyof F]: F[Key] extends Kind ? Key : never }[keyof F];
type Flat<Type> = { readonly [Key in keyof Type]: Type[Key] };

/** The object type of a set of fields, where each field of a kind in `Missing` may be left out. */
type Shaped<F, Missing> = Flat<
  { [Key in Exclude<keyof F, KeysOf<F, Missing>>]: ValueOf<F[Key]> } & {
    [Key in KeysOf<F, Missing>]?: ValueOf<F[Key]>;
  }
>;

/** The type that a set of fields describes: what a record holds, or what a local change receives. */
export type TypeOf<F extends Fields> = Shaped<F, CanBeMissing>;

/** What a caller passes to run a command: its input, where each stamp may be left out. */
export type CallOf<F extends Fields> = Shaped<F, CanBeMissing | StampKind>;

/**
 * A string of at most `max` and at least `min` characters. The client and the
 * server both hold a value to it.
 */
export function text(options: { readonly max: number; readonly min?: number }): TextField {
  return options.min === undefined
    ? { kind: 'string', max: options.max }
    : { kind: 'string', max: options.max, min: options.min };
}

/** A string that is one of the values, such as `oneOf('draft', 'sent')`. Its type is their union. */
export function oneOf<const Values extends ReadonlyArray<string>>(
  ...values: Values
): EnumField<Values[number]> {
  return { kind: 'enum', values };
}

/** A list whose items all have the kind `of`, such as `list('string')` or `list(shape({ ... }))`. */
export function list<const Of extends RecordField>(of: Of): ListField<Of> {
  return { kind: 'list', of };
}

/** A plain object with the fields given, each with its own kind. */
export function shape<const F extends Readonly<Record<string, RecordField>>>(
  fields: F,
): ShapeField<F> {
  return { kind: 'shape', fields };
}

/** The kind `of`, or null, or no value. For a scalar, the `?` form says the same: `'string?'`. */
export function optional<const Of extends RecordField>(of: Of): OptionalField<Of> {
  return { kind: 'optional', of };
}

const isObject = (value: unknown): value is object =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

/** Whether a value has a kind with no parts: a scalar, its `?` form, `json` or a stamp. */
function plainMatches(kind: string, value: unknown): boolean {
  if (kind === 'json') {
    return true;
  }
  if (kind.endsWith('?') && (value === null || value === undefined)) {
    return true;
  }
  switch (kind.replace('?', '')) {
    // JSON has no NaN or Infinity, so a number that is not finite never came from a record.
    case 'number': {
      return Number.isFinite(value);
    }
    case 'integer': {
      return Number.isInteger(value);
    }
    case 'array': {
      return Array.isArray(value);
    }
    case 'object': {
      return isObject(value);
    }
    case 'boolean': {
      return typeof value === 'boolean';
    }
    // `string`, and the stamps, which travel as strings.
    default: {
      return typeof value === 'string';
    }
  }
}

function kindMatches(kind: InputField, value: unknown): boolean {
  if (typeof kind !== 'object') {
    return plainMatches(kind, value);
  }
  switch (kind.kind) {
    case 'string': {
      return (
        typeof value === 'string' && value.length <= kind.max && value.length >= (kind.min ?? 0)
      );
    }
    case 'enum': {
      return typeof value === 'string' && kind.values.includes(value);
    }
    case 'list': {
      return Array.isArray(value) && value.every((item) => kindMatches(kind.of, item));
    }
    case 'shape': {
      return (
        isObject(value) &&
        Object.entries(kind.fields).every(([name, of]) => kindMatches(of, Reflect.get(value, name)))
      );
    }
    case 'optional': {
      return value === null || value === undefined || kindMatches(kind.of, value);
    }
  }
}

/**
 * The names of the fields that a value does not fit, so an error can name them.
 * A value that is not an object does not fit any field, so each name comes back.
 */
export function unfitting(fields: Fields, value: unknown): ReadonlyArray<string> {
  return Object.entries(fields)
    .filter(([name, kind]) => !isObject(value) || !kindMatches(kind, Reflect.get(value, name)))
    .map(([name]) => name);
}

/**
 * The names of the keys of a value that no field declares. The server checks
 * them before a record leaves it, so a column of a table that the contract
 * does not name never reaches a client.
 */
export function undeclared(fields: Fields, value: unknown): ReadonlyArray<string> {
  return isObject(value) ? Object.keys(value).filter((name) => !(name in fields)) : [];
}

/**
 * Whether a value has each field, with the right kind. The object pool holds
 * plain JSON from the server and the local database, so it checks a record or
 * a saved input before code reads it with its type. The server runs the same
 * check on the input of each command, so both sides agree on what is valid.
 */
export function matches<const F extends Fields>(fields: F, value: unknown): value is TypeOf<F> {
  return (
    isObject(value) &&
    Object.entries(fields).every(([name, kind]) => kindMatches(kind, Reflect.get(value, name)))
  );
}

/** Where the object pool gets a new ID and the time of a run. A test gives fixed ones. */
export type Stamps = { readonly newId: () => string; readonly now: () => string };

/**
 * The input of one run, with each stamp that the caller left out filled in.
 * The result is saved with the transaction, so a replay reads the same ID
 * and time as the first run.
 */
export function stamped(
  fields: Fields,
  input: Readonly<Record<string, unknown>>,
  stamps: Stamps,
): Readonly<Record<string, unknown>> {
  const filled: Record<string, unknown> = { ...input };
  for (const [name, kind] of Object.entries(fields)) {
    if (filled[name] === undefined && kind === 'new-id') {
      filled[name] = stamps.newId();
    }
    if (filled[name] === undefined && kind === 'now') {
      filled[name] = stamps.now();
    }
  }
  return filled;
}
