/**
 * The JSON kind of one field of a record or a command input. A kind that ends
 * in `?` also allows null and a missing field. `json` allows any value.
 */
type FieldKind = 'string' | 'number' | 'boolean' | 'string?' | 'number?' | 'boolean?' | 'json';

/** The kind that a field type needs. A type with no plain JSON kind gives `never`, so it fails to compile. */
type KindOf<Value> = unknown extends Value
  ? 'json'
  : [Value] extends [string]
    ? 'string'
    : [Value] extends [number]
      ? 'number'
      : [Value] extends [boolean]
        ? 'boolean'
        : [Value] extends [string | null | undefined]
          ? 'string?'
          : [Value] extends [number | null | undefined]
            ? 'number?'
            : [Value] extends [boolean | null | undefined]
              ? 'boolean?'
              : never;

/**
 * The fields of a type and the JSON kind of each. The compiler checks that a
 * shape names every field of the type with the right kind, so the shape and
 * the type cannot drift apart.
 */
export type Shape<Type> = { readonly [Key in keyof Type]-?: KindOf<Type[Key]> };

function kindMatches(kind: FieldKind, value: unknown): boolean {
  if (kind === 'json') {
    return true;
  }
  if (kind.endsWith('?') && (value === null || value === undefined)) {
    return true;
  }
  return typeof value === kind.replace('?', '');
}

/**
 * Whether a value has each field of the shape, with the right JSON kind. The
 * object pool holds plain JSON from the server and the local database, so it
 * checks a record or a saved input against its shape before code reads it
 * with its type. This is plain TypeScript, so it adds no Effect code to the
 * first screen.
 */
export function matches<Type>(shape: Shape<Type>, value: unknown): value is Type {
  if (typeof value !== 'object' || value === null) {
    return false;
  }
  const kinds: Record<string, FieldKind> = shape;
  return Object.entries(kinds).every(([field, kind]) =>
    kindMatches(kind, Reflect.get(value, field)),
  );
}
