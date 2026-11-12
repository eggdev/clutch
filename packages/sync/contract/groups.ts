/**
 * Sync groups, as a contract names them. A group decides which clients get a
 * record. A record declares its groups as data, so the manifest can list
 * them and a change of group shows in a diff.
 */

/** What `groupsOf` may read besides the record: the organization that owns it. */
export type GroupScope = { readonly organizationId: string };

/** When a record is in a group: only while one of its fields has, or has not, one of the values. */
type Condition<Field extends string> = {
  readonly field: Field;
  readonly values: ReadonlyArray<string | number | boolean>;
  /** `true` for `unless`: the record is in the group while the field has none of the values. */
  readonly not: boolean;
};

/**
 * One group of a record: the group that a field of the record names, such as
 * the space of a note, or the group of the organization that owns it. With
 * `when`, the record is in the group only while the condition holds.
 */
export type GroupRef<Field extends string = string> = (
  | { readonly prefix: string; readonly field: Field }
  | { readonly prefix: string; readonly scope: 'organizationId' }
) & { readonly when?: Condition<Field> };

/** One kind of sync group, such as the groups of spaces. */
export type Group<Prefix extends string = string> = {
  readonly prefix: Prefix;
  /** The group of one ID, such as `space:<id>`. */
  readonly of: (id: string) => string;
  /** The ID of a group of this kind, or `undefined` for a group of another kind. */
  readonly idOf: (group: string) => string | undefined;
  /** In a record: the group that one of its fields names. */
  readonly by: <const Field extends string>(
    field: Field,
  ) => { readonly prefix: Prefix; readonly field: Field };
  /** In a record: the group of the organization that owns the record. */
  readonly ofScope: { readonly prefix: Prefix; readonly scope: 'organizationId' };
};

/** Defines one kind of sync group. Its groups are `<prefix>:<id>`. */
export function defineGroup<const Prefix extends string>(prefix: Prefix): Group<Prefix> {
  const start = `${prefix}:`;
  return {
    prefix,
    of: (id) => `${start}${id}`,
    idOf: (group) => (group.startsWith(start) ? group.slice(start.length) : undefined),
    by: (field) => ({ prefix, field }),
    ofScope: { prefix, scope: 'organizationId' },
  };
}

/**
 * A group that holds the record only while `field` has one of `values`, such
 * as `when('frozen', [true], sharedGroup.by('projectId'))`.
 */
export function when<const Field extends string, const Ref extends GroupRef>(
  field: Field,
  values: ReadonlyArray<string | number | boolean>,
  ref: Ref,
): Ref & { readonly when: Condition<Field> } {
  return { ...ref, when: { field, values, not: false } };
}

/**
 * A group that holds the record only while `field` has none of `values`,
 * such as `unless('status', ['draft', 'ready'], sharedGroup.by('projectId'))`.
 */
export function unless<const Field extends string, const Ref extends GroupRef>(
  field: Field,
  values: ReadonlyArray<string | number | boolean>,
  ref: Ref,
): Ref & { readonly when: Condition<Field> } {
  return { ...ref, when: { field, values, not: true } };
}

/** Whether the condition of a group holds for a record. A group with no condition always holds it. */
function holds(ref: GroupRef, record: Readonly<Record<string, unknown>>): boolean {
  const condition = ref.when;
  if (!condition) {
    return true;
  }
  const value = record[condition.field];
  return condition.values.some((allowed) => allowed === value) !== condition.not;
}

/** The groups of one record, from the group references of its declaration. */
export function groupsOf(
  refs: ReadonlyArray<GroupRef>,
  record: Readonly<Record<string, unknown>>,
  scope: GroupScope,
): ReadonlyArray<string> {
  return refs
    .filter((ref) => holds(ref, record))
    .map((ref) =>
      'field' in ref
        ? `${ref.prefix}:${String(record[ref.field])}`
        : `${ref.prefix}:${scope.organizationId}`,
    );
}
