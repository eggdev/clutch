import { matches, undeclared } from '@repo/sync/contract/fields';
import type { RecordField, TypeOf } from '@repo/sync/contract/fields';
import { groupsOf } from '@repo/sync/contract/groups';
import type { Group, GroupRef, GroupScope } from '@repo/sync/contract/groups';

/** One record in the object pool. Its fields are plain JSON, as the server sent them. */
export type RecordRow = { readonly id: string } & Readonly<Record<string, unknown>>;

/** The fields of a record. Each record has a string `id`. */
export type RecordFields = { readonly id: 'string' } & Readonly<Record<string, RecordField>>;

/**
 * One kind of record, as the object pool and the server use it. Screens read
 * records of a model from the pool. `groupsOf` names the sync groups of a
 * record: a client gets the record only when it has loaded one of them. `is`
 * checks a record from the pool against its fields, so code reads it with
 * its type.
 */
export type Model<Row> = {
  readonly name: string;
  readonly groupsOf: (record: RecordRow, scope: GroupScope) => ReadonlyArray<string>;
  readonly is: (record: unknown) => record is Row;
  /** The names of the keys of a record that the declaration does not name. */
  readonly undeclared: (record: unknown) => ReadonlyArray<string>;
};

/** A record as a contract declares it: a model, with its fields and groups as data. */
export type RecordDeclaration<
  Name extends string = string,
  F extends RecordFields = RecordFields,
> = Model<TypeOf<F>> & {
  readonly kind: 'record';
  readonly name: Name;
  readonly fields: F;
  readonly groups: ReadonlyArray<GroupRef>;
};

/** The type of the records of a model, such as `RowOf<typeof note>`. */
export type RowOf<Declared> = Declared extends Model<infer Row> ? Row : never;

const recordName = /^[A-Z][A-Za-z0-9]*$/u;

/**
 * Declares one kind of record. The name is the model name in each change.
 * `fields` gives the kind of each field, and the record type comes from it,
 * so no second declaration can drift. `groups` names the sync groups of a
 * record, such as `spaceGroup.by('spaceId')`.
 */
export function record<const Name extends string, const F extends RecordFields>(
  name: Name,
  definition: {
    readonly fields: F;
    readonly groups: ReadonlyArray<GroupRef<keyof F & string>>;
  },
): RecordDeclaration<Name, F> {
  if (!recordName.test(name)) {
    throw new Error(
      `The record name "${name}" is not Pascal case. Name it like \`Note\` or \`SpaceNoteCount\`.`,
    );
  }
  if (definition.groups.length === 0) {
    throw new Error(
      `The record ${name} names no sync group, so no client would get it. Add one to \`groups\`, such as \`organizationGroup.ofScope\`.`,
    );
  }
  return {
    kind: 'record',
    name,
    fields: definition.fields,
    groups: definition.groups,
    groupsOf: (row, scope) => groupsOf(definition.groups, row, scope),
    is: (row): row is TypeOf<F> => matches(definition.fields, row),
    undeclared: (row) => undeclared(definition.fields, row),
  };
}

/**
 * What a load function offers to an agent: a tool that lists the records of
 * the group with the `fields` named, and one that gets a whole record.
 * `says` is what the caller reads before it calls them.
 */
export type ReadTool<Field extends string = string> = {
  readonly says: string;
  readonly fields: ReadonlyArray<Field>;
};

/**
 * A load function: how a screen asks for the records of one group, such as
 * the notes of one space. A gate calls it before it navigates. An agent reads
 * the same records through its `tool`, with the same access.
 */
export type Load<Name extends string = string> = {
  readonly kind: 'load';
  readonly name: Name;
  readonly record: string;
  readonly prefix: string;
  readonly group: (id: string) => string;
  readonly tool: ReadTool | 'none';
};

const loadName = /^[a-z][a-z0-9-]*\/[a-z][a-z0-9-]*$/u;

/**
 * Declares a load function: the records of one kind of group, by the ID that
 * names the group. A gate passes the group to the sync engine and waits.
 * `tool` has no default: `'none'`, or what an agent may read through it.
 */
export function load<const Name extends string, const F extends RecordFields>(
  name: Name,
  of: { readonly name: string; readonly fields: F },
  group: Group,
  options: { readonly tool: ReadTool<keyof F & string> | 'none' },
): Load<Name> {
  if (!loadName.test(name)) {
    throw new Error(
      `The load function name "${name}" is not \`<contract>/<name>\` in kebab case, such as \`notes/of-space\`.`,
    );
  }
  return {
    kind: 'load',
    name,
    record: of.name,
    prefix: group.prefix,
    group: group.of,
    tool: options.tool,
  };
}
