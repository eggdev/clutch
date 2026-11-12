import type { ManifestKind } from '@repo/sync/contract/manifest';

/**
 * One difference between two manifests. A `two-way` change is safe for an
 * installed build: it keeps working, and a revert removes every trace. A
 * `one-way` change is not: an installed build can hold a record, or send an
 * input, that today's code no longer takes. See
 * docs/principles/two-way-doors.md and docs/principles/older-copies-recover.md.
 */
export type ManifestChange = {
  /** Stable across runs, such as `command-removed:notes/rename`. */
  readonly id: string;
  readonly door: 'two-way' | 'one-way';
  /** What changed and what it does to an installed build, in one sentence. */
  readonly says: string;
};

export const oneWay = (id: string, says: string): ManifestChange => ({
  id,
  door: 'one-way',
  says,
});
export const twoWay = (id: string, says: string): ManifestChange => ({
  id,
  door: 'two-way',
  says,
});

export const same = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);

/** A kind that a value may leave out: an optional kind, or `json`. */
export function canBeMissing(kind: ManifestKind): boolean {
  return typeof kind === 'string'
    ? kind.endsWith('?') || kind === 'json'
    : kind.kind === 'optional';
}

/** The kind without its "may be missing" part: `string` for `string?`, and the inner kind of an optional. */
function required(kind: ManifestKind): ManifestKind {
  if (typeof kind === 'string') {
    return kind.endsWith('?') ? kind.slice(0, -1) : kind;
  }
  return kind.kind === 'optional' ? required(kind.of) : kind;
}

/** Whether a plain kind, by name, takes each value of another required kind. */
function nameWidens(before: ManifestKind, after: string): boolean {
  if (typeof before === 'string') {
    // A number takes each integer.
    return after === 'number' && before === 'integer';
  }
  // A plain string takes each text and each enum value, an array each list, an object each shape.
  return (
    (after === 'string' && (before.kind === 'string' || before.kind === 'enum')) ||
    (after === 'array' && before.kind === 'list') ||
    (after === 'object' && before.kind === 'shape')
  );
}

type Widens = (before: ManifestKind, after: ManifestKind) => boolean;

/** Whether a kind with parts takes each value of another kind with parts. `each` compares the parts. */
function partsWiden(
  before: Exclude<ManifestKind, string>,
  after: Exclude<ManifestKind, string>,
  each: Widens,
): boolean {
  if (before.kind === 'string' && after.kind === 'string') {
    return after.max >= before.max && after.min <= before.min;
  }
  if (before.kind === 'enum' && after.kind === 'enum') {
    return before.values.every((value) => after.values.includes(value));
  }
  if (before.kind === 'list' && after.kind === 'list') {
    return each(before.of, after.of);
  }
  if (before.kind === 'shape' && after.kind === 'shape') {
    // Each old field still fits, and each field that the new shape adds may be left out.
    return Object.entries(after.fields).every(([name, kind]) => {
      const old = before.fields[name];
      return old === undefined ? canBeMissing(kind) : each(old, kind);
    });
  }
  return false;
}

/**
 * Whether every value of the old kind is still a value of the new kind. An
 * input that widens still takes each write that an installed build sends.
 */
export function widens(before: ManifestKind, after: ManifestKind): boolean {
  if (after === 'json') {
    return true;
  }
  if (canBeMissing(before) && !canBeMissing(after)) {
    return false;
  }
  const old = required(before);
  const next = required(after);
  if (same(old, next)) {
    return true;
  }
  if (typeof next === 'string') {
    return nameWidens(old, next);
  }
  return typeof old === 'string' ? false : partsWiden(old, next, widens);
}

/** The entries of a list by name. */
function byName<Entry extends { readonly name: string }>(entries: ReadonlyArray<Entry>) {
  return new Map(entries.map((entry) => [entry.name, entry]));
}

/** The names that only `before` has, only `after` has, and that both have. */
export function split<Entry extends { readonly name: string }>(
  before: ReadonlyArray<Entry>,
  after: ReadonlyArray<Entry>,
) {
  const old = byName(before);
  const next = byName(after);
  return {
    removed: before.filter((entry) => !next.has(entry.name)),
    added: after.filter((entry) => !old.has(entry.name)),
    kept: after.flatMap((entry) => {
      const previous = old.get(entry.name);
      return previous ? [[previous, entry] as const] : [];
    }),
  };
}
