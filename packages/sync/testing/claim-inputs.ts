import type { Fields, InputField } from '@repo/sync/contract/fields';
import type { RecordDeclaration, RecordRow } from '@repo/sync/contract/record';
import { between, pick } from '@repo/sync/testing/seeded';
import type { Random } from '@repo/sync/testing/seeded';

/**
 * The inputs that `proveClaims` runs, made from the declared fields of a
 * command or a record. A valid value fits its kind. An invalid value breaks
 * one declared limit of its kind. See docs/contributing/architecture/contract.md#claims.
 */

/**
 * The values of each plain `string` field, IDs included. They are few, so a
 * command that names a record by its ID finds a record that the run put in
 * the pool before it.
 */
export const words: ReadonlyArray<string> = ['k1', 'k2', 'k3'];

const letters = 'abcdefghijklmnopqrstuvwxyz';

/** A text of `length` letters. */
function textOf(random: Random, length: number): string {
  let made = '';
  for (let index = 0; index < length; index += 1) {
    made += pick(random, [...letters]);
  }
  return made;
}

/** A value of a kind with no parts, or of its `?` form. */
function plainValue(random: Random, kind: string): unknown {
  if (kind.endsWith('?') && random() < 0.3) {
    return random() < 0.5 ? null : undefined;
  }
  switch (kind.replace('?', '')) {
    case 'string': {
      return pick(random, words);
    }
    case 'number': {
      return pick(random, [0, -1.5, 3.25, Math.round(random() * 100_000) / 100]);
    }
    case 'integer': {
      return pick(random, [0, 1, -7, between(random, -1000, 1000)]);
    }
    case 'boolean': {
      return random() < 0.5;
    }
    case 'array': {
      return pick(random, [[], [1, 'a']]);
    }
    case 'object': {
      return pick(random, [{}, { a: 1 }]);
    }
    case 'json': {
      return pick(random, [null, 1, 'x', { a: [1] }]);
    }
    default: {
      throw new Error(`The kind \`${kind}\` is not a kind that a contract declares.`);
    }
  }
}

/**
 * A value that fits the kind, made by the generator. A stamp gives no value,
 * so the object pool fills it, as it does for a screen. It throws for a
 * kind that no value fits, such as `oneOf()` with no values.
 */
function validValue(random: Random, kind: InputField): unknown {
  if (kind === 'new-id' || kind === 'now') {
    return undefined;
  }
  if (typeof kind !== 'object') {
    return plainValue(random, kind);
  }
  switch (kind.kind) {
    case 'string': {
      const min = kind.min ?? 0;
      if (min > kind.max) {
        throw new Error(`No text is at least ${min} and at most ${kind.max} characters.`);
      }
      // The shortest and the longest length each come up, as edges break most often.
      return textOf(random, pick(random, [min, kind.max, between(random, min, kind.max)]));
    }
    case 'enum': {
      if (kind.values.length === 0) {
        throw new Error('`oneOf` names no value.');
      }
      return pick(random, kind.values);
    }
    case 'list': {
      const count = between(random, 0, 3);
      return Array.from({ length: count }, () => validValue(random, kind.of));
    }
    case 'shape': {
      return Object.fromEntries(
        Object.entries(kind.fields)
          .map(([name, of]) => [name, validValue(random, of)])
          .filter(([, value]) => value !== undefined),
      );
    }
    case 'optional': {
      if (random() < 0.3) {
        return random() < 0.5 ? null : undefined;
      }
      return validValue(random, kind.of);
    }
  }
}

/** An object that fits each of the fields. A field whose value is no value is left out. */
export function validInput(random: Random, fields: Fields): Record<string, unknown> {
  const input: Record<string, unknown> = {};
  for (const [name, kind] of Object.entries(fields)) {
    const value = validValue(random, kind);
    if (value !== undefined) {
      input[name] = value;
    }
  }
  return input;
}

/** A record that fits its declaration, with the ID given. */
export function validRecord(random: Random, declared: RecordDeclaration, id: string): RecordRow {
  return { ...validInput(random, declared.fields), id };
}

/** One value that breaks a limit of its kind, and the words for the limit. */
export type Breach = { readonly value: unknown; readonly breaks: string };

/** The values that break a kind with no parts. A `?` form takes null, so null is no breach. */
function plainBreaches(kind: string): Array<Breach> {
  const base = kind.replace('?', '');
  const missing: Array<Breach> = kind.endsWith('?')
    ? []
    : [{ value: undefined, breaks: 'is required' }];
  switch (base) {
    case 'json': {
      return [];
    }
    case 'string':
    case 'new-id':
    case 'now': {
      return [{ value: 42, breaks: 'is a string' }];
    }
    case 'number': {
      return [...missing, { value: 'x', breaks: 'is a number' }];
    }
    case 'integer': {
      return [...missing, { value: 1.5, breaks: 'is a whole number' }];
    }
    case 'boolean': {
      return [...missing, { value: 'yes', breaks: 'is true or false' }];
    }
    case 'array': {
      return [...missing, { value: {}, breaks: 'is an array' }];
    }
    case 'object': {
      return [...missing, { value: [], breaks: 'is a plain object' }];
    }
    default: {
      return [];
    }
  }
}

/**
 * Each value that breaks one declared limit of the kind: a text that is too
 * long or too short, a value outside `oneOf`, a value of another kind, a
 * required value left out, and the same inside a list or a shape. `json`
 * has no limit, and a stamp is filled when it is left out.
 */
export function breaches(random: Random, kind: InputField): Array<Breach> {
  if (typeof kind !== 'object') {
    const found = plainBreaches(kind);
    // A plain string that is left out is refused too, but a stamp is filled.
    return kind === 'string' ? [{ value: undefined, breaks: 'is required' }, ...found] : found;
  }
  switch (kind.kind) {
    case 'string': {
      const min = kind.min ?? 0;
      return [
        { value: textOf(random, kind.max + 1), breaks: `is at most ${kind.max} characters` },
        ...(min > 0
          ? [{ value: textOf(random, min - 1), breaks: `is at least ${min} characters` }]
          : []),
        { value: 42, breaks: 'is a string' },
        { value: undefined, breaks: 'is required' },
      ];
    }
    case 'enum': {
      return [
        { value: `not-${kind.values.join('-')}`, breaks: `is one of ${kind.values.join(', ')}` },
        { value: undefined, breaks: 'is required' },
      ];
    }
    case 'list': {
      const inner = breaches(random, kind.of).filter((breach) => breach.value !== undefined);
      return [
        { value: 'x', breaks: 'is a list' },
        { value: undefined, breaks: 'is required' },
        ...inner.map((breach) => ({
          value: [breach.value],
          breaks: `has items that ${breach.breaks}`,
        })),
      ];
    }
    case 'shape': {
      const base = validInput(random, kind.fields);
      return [
        { value: 'x', breaks: 'is a plain object' },
        { value: undefined, breaks: 'is required' },
        ...Object.entries(kind.fields).flatMap(([name, of]) =>
          breaches(random, of).map((breach) => ({
            value: { ...base, [name]: breach.value },
            breaks: `has a field ${name} that ${breach.breaks}`,
          })),
        ),
      ];
    }
    case 'optional': {
      return breaches(random, kind.of).filter((breach) => breach.value !== undefined);
    }
  }
}
