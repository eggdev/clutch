/**
 * The part of JSON Schema (draft 2020-12) that the factory schemas use, and a
 * validator for it. Each kind's schema is written once in this form. The
 * check runs it here, and `clutch factory --write-schemas` writes it as a
 * plain JSON Schema file that any validator reads. A schema may use only the
 * keywords below, so the two always agree.
 */

type Common = { description?: string };

export type StringSchema = Common & {
  type: 'string';
  enum?: Array<string>;
  const?: string;
  /** Unanchored, as in JSON Schema. Anchor it with ^ and $ to match the whole value. */
  pattern?: string;
};

export type NumberSchema = Common & {
  type: 'number' | 'integer';
  minimum?: number;
  maximum?: number;
  default?: number;
};

type BooleanSchema = Common & { type: 'boolean'; default?: boolean };

export type ArraySchema = Common & {
  type: 'array';
  items: Schema;
  minItems?: number;
  maxItems?: number;
  uniqueItems?: boolean;
};

export type ObjectSchema = Common & {
  type: 'object';
  properties: Record<string, Schema>;
  required?: Array<string>;
  additionalProperties: false;
};

/** Objects told apart by the `const` of one property, such as a trigger's `type`. */
export type OneOfSchema = Common & { oneOf: Array<ObjectSchema> };

export type Schema =
  | StringSchema
  | NumberSchema
  | BooleanSchema
  | ArraySchema
  | ObjectSchema
  | OneOfSchema;

/** A problem at a key path such as `labels[1].score`. The empty path is the whole value. */
export type SchemaProblem = { key: string; reason: string };

type Check = (schema: Schema, value: unknown, at: string, out: Array<SchemaProblem>) => void;

const show = (value: unknown) => JSON.stringify(value) ?? String(value);
const join = (at: string, key: string) => (at ? `${at}.${key}` : key);
const isMap = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

/** The property whose `const` tells the branches of a `oneOf` apart. */
function discriminator(schema: OneOfSchema) {
  const [first] = schema.oneOf;
  const key = Object.keys(first.properties).find((name) =>
    schema.oneOf.every((branch) => {
      const property = branch.properties[name];
      return property && 'const' in property && property.const !== undefined;
    }),
  );
  if (!key) {
    throw new Error('A oneOf schema needs a property with a const in each branch.');
  }
  return {
    key,
    values: schema.oneOf.map((branch) => (branch.properties[key] as StringSchema).const as string),
  };
}

function checkObject(
  schema: ObjectSchema,
  value: unknown,
  at: string,
  out: Array<SchemaProblem>,
  visit: Check,
) {
  if (!isMap(value)) {
    out.push({ key: at, reason: `Expected a map. Got ${show(value)}.` });
    return;
  }
  for (const key of schema.required ?? []) {
    if (value[key] === undefined) {
      const about = schema.properties[key]?.description;
      out.push({ key: join(at, key), reason: `Missing.${about ? ` ${about}` : ''}` });
    }
  }
  for (const [key, item] of Object.entries(value)) {
    const property = schema.properties[key];
    if (!property) {
      const known = Object.keys(schema.properties).join(', ');
      out.push({ key: join(at, key), reason: `Unknown key. The known keys are ${known}.` });
    } else if (item !== undefined) {
      visit(property, item, join(at, key), out);
    }
  }
}

function checkArray(
  schema: ArraySchema,
  value: unknown,
  at: string,
  out: Array<SchemaProblem>,
  visit: Check,
) {
  if (!Array.isArray(value)) {
    out.push({ key: at, reason: `Expected a list. Got ${show(value)}.` });
    return;
  }
  const { minItems = 0, maxItems = Infinity } = schema;
  if (value.length < minItems || value.length > maxItems) {
    const range = maxItems === Infinity ? `at least ${minItems}` : `${minItems} to ${maxItems}`;
    out.push({ key: at, reason: `Expected ${range} items. Got ${value.length}.` });
  }
  if (schema.uniqueItems) {
    const seen = new Set<string>();
    for (const item of value) {
      if (seen.has(show(item))) {
        out.push({ key: at, reason: `${show(item)} is in the list more than once.` });
      }
      seen.add(show(item));
    }
  }
  for (const [index, item] of value.entries()) {
    visit(schema.items, item, `${at}[${index}]`, out);
  }
}

function checkString(schema: StringSchema, value: unknown, at: string, out: Array<SchemaProblem>) {
  if (typeof value !== 'string') {
    out.push({ key: at, reason: `Expected a string. Got ${show(value)}.` });
  } else if (schema.enum && !schema.enum.includes(value)) {
    out.push({ key: at, reason: `Expected one of ${schema.enum.join(', ')}. Got ${show(value)}.` });
  } else if (schema.const !== undefined && value !== schema.const) {
    out.push({ key: at, reason: `Expected ${schema.const}. Got ${show(value)}.` });
  } else if (schema.pattern && !new RegExp(schema.pattern, 'u').test(value)) {
    out.push({
      key: at,
      reason: `${show(value)} is not valid. ${schema.description ?? ''}`.trim(),
    });
  }
}

function checkNumber(schema: NumberSchema, value: unknown, at: string, out: Array<SchemaProblem>) {
  const whole = schema.type === 'integer';
  if (typeof value !== 'number' || (whole && !Number.isInteger(value))) {
    out.push({
      key: at,
      reason: `Expected ${whole ? 'a whole number' : 'a number'}. Got ${show(value)}.`,
    });
    return;
  }
  const { minimum = -Infinity, maximum = Infinity } = schema;
  if (value < minimum || value > maximum) {
    out.push({ key: at, reason: `Expected a number from ${minimum} to ${maximum}. Got ${value}.` });
  }
}

function checkOneOf(
  schema: OneOfSchema,
  value: unknown,
  at: string,
  out: Array<SchemaProblem>,
  visit: Check,
) {
  if (!isMap(value)) {
    out.push({ key: at, reason: `Expected a map. Got ${show(value)}.` });
    return;
  }
  const { key, values } = discriminator(schema);
  const index = values.indexOf(value[key] as string);
  if (index === -1) {
    out.push({
      key: join(at, key),
      reason: `Expected one of ${values.join(', ')}. Got ${show(value[key])}.`,
    });
    return;
  }
  checkObject(schema.oneOf[index], value, at, out, visit);
}

/** Adds a problem to `out` for each way `value` breaks `schema`. */
export function check(schema: Schema, value: unknown, at: string, out: Array<SchemaProblem>) {
  if ('oneOf' in schema) {
    checkOneOf(schema, value, at, out, check);
    return;
  }
  switch (schema.type) {
    case 'object': {
      checkObject(schema, value, at, out, check);
      break;
    }
    case 'array': {
      checkArray(schema, value, at, out, check);
      break;
    }
    case 'string': {
      checkString(schema, value, at, out);
      break;
    }
    case 'number':
    case 'integer': {
      checkNumber(schema, value, at, out);
      break;
    }
    case 'boolean': {
      if (typeof value !== 'boolean') {
        out.push({ key: at, reason: `Expected true or false. Got ${show(value)}.` });
      }
      break;
    }
  }
}
