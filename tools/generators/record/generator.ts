import path from 'node:path';

import type { Tree } from '@nx/devkit';
import { generateFiles, logger, names } from '@nx/devkit';
import {
  addToArray,
  declaresConstant,
  insertBeforeContract,
  mergeNamedImport,
} from '@tools/generators/shared/registry.ts';
import { addDependencies, afterWrite } from '@tools/generators/shared/workspace.ts';

export type RecordOptions = {
  readonly package: string;
  readonly name: string;
  /**
   * The sync group of each record: `org`, `user`, or `<kind>:<field>` such as
   * `space:spaceId`. The CLI requires it, so a record never syncs to the whole
   * organization by accident.
   */
  readonly group?: string;
};

/** A parsed `--group`: the group kind, and the record field that holds its ID. */
export type GroupChoice = { readonly kind: string; readonly field: string | null };

/** The organization group: every actor in the organization gets the record. */
const organizationOnly: GroupChoice = { kind: 'org', field: null };

/** Reads `--group`. `org` needs no field; `user` reads `userId`; `<kind>:<field>` names both. */
export function parseGroup(group: string): GroupChoice {
  if (group === 'org') {
    return organizationOnly;
  }
  if (group === 'user') {
    return { kind: 'user', field: 'userId' };
  }
  const match = /^([a-z][a-z-]*):([a-z][A-Za-z0-9]*)$/u.exec(group);
  if (!match || match[1] === 'org') {
    throw new Error(
      `--group=${group} is not a group. Use \`org\`, \`user\`, or \`<kind>:<field>\` such as \`space:spaceId\`.`,
    );
  }
  return { kind: match[1], field: match[2] };
}

/** The values that write the group of a record: its reference, the name to import, and its note. */
function groupValues(choice: GroupChoice) {
  if (choice.field === null) {
    return {
      groupField: '',
      groupKind: 'org',
      groupRef: 'organizationGroup.ofScope',
      groupImport: 'organizationGroup',
      groupModule: '@repo/sync/contract/engine-groups',
      groupNote: 'Every actor in the organization gets them.',
    };
  }
  if (choice.kind === 'user') {
    return {
      groupField: choice.field,
      groupKind: 'user',
      groupRef: `userGroup.by('${choice.field}')`,
      groupImport: 'userGroup',
      groupModule: '@repo/sync/contract/engine-groups',
      groupNote: `Only the user in \`${choice.field}\` gets each one.`,
    };
  }
  return {
    groupField: choice.field,
    groupKind: choice.kind,
    groupRef: `defineGroup('${choice.kind}').by('${choice.field}')`,
    groupImport: 'defineGroup',
    groupModule: '@repo/sync/contract/groups',
    groupNote: `Only actors who load the \`${choice.kind}\` group in \`${choice.field}\` get each one. Use the group of the package that owns \`${choice.kind}\` groups if it exports one.`,
  };
}

/** The group of a record that a caller made without `--group`: the organization, with a notice. */
function chosenGroup(options: RecordOptions): GroupChoice {
  if (options.group === undefined) {
    logger.info(
      `${options.name} syncs to the whole organization. Pass --group to choose its sync group.`,
    );
    return organizationOnly;
  }
  return parseGroup(options.group);
}

const tableImports = "import { pgTable, text, timestamp } from 'drizzle-orm/pg-core';\n";

/** The declaration of a record in the contract: the record, and its type. */
function recordDeclaration(
  className: string,
  property: string,
  values: ReturnType<typeof groupValues>,
) {
  const fields = [
    "id: 'string'",
    ...(values.groupField ? [`${values.groupField}: 'string'`] : []),
    "createdAt: 'string'",
    "updatedAt: 'string'",
  ].join(', ');
  return [
    '/**',
    ` * ${className} records in the object pool. Screens read them through the sync`,
    ` * hooks in \`@repo/sync/ui/\`. ${values.groupNote}`,
    ' */',
    `export const ${property}Record = record('${className}', {`,
    `  fields: { ${fields} },`,
    `  groups: [${values.groupRef}],`,
    '});',
    `export type ${className} = RowOf<typeof ${property}Record>;`,
  ].join('\n');
}

/**
 * Writes the table of a record in `repo/schema.ts`, and the mapping between a
 * row and the public record with its round-trip test. The schema is
 * hand-written, so the table shape never becomes the interface. drizzle-kit
 * writes the migration later, from `db-generate`.
 */
export function addTable(
  tree: Tree,
  packageName: string,
  record: string,
  group: GroupChoice = organizationOnly,
) {
  const directory = `packages/${packageName}`;
  const name = names(record);
  const values = groupValues(group);
  const groupColumn = values.groupField
    ? [
        `  ${values.groupField}: text('${values.groupField.replaceAll(/[A-Z]/gu, (letter) => `_${letter.toLowerCase()}`)}').notNull(),`,
      ]
    : [];
  const title = name.fileName.replaceAll('-', ' ');
  const tableName = `${name.propertyName}Records`;
  const schemaFile = `${directory}/repo/schema.ts`;
  const table = [
    '',
    `/** The owner records of ${title}. Each one belongs to one organization. */`,
    `export const ${tableName} = pgTable('${name.fileName.replaceAll('-', '_')}', {`,
    "  id: text('id').primaryKey(),",
    "  organizationId: text('organization_id').notNull(),",
    ...groupColumn,
    "  createdAt: timestamp('created_at', { withTimezone: true, mode: 'date' }).notNull(),",
    "  updatedAt: timestamp('updated_at', { withTimezone: true, mode: 'date' }).notNull(),",
    '});',
    '',
    `export type ${name.className}Row = typeof ${tableName}.$inferSelect;`,
    '',
  ].join('\n');
  tree.write(schemaFile, `${tree.read(schemaFile, 'utf-8') ?? tableImports}${table}`);
  generateFiles(tree, path.join(import.meta.dirname, 'table'), `${directory}/repo`, {
    ...name,
    ...values,
    packageName,
    title,
  });
}

/**
 * Declares a record in the package contract, `packages/<pkg>/contract/<pkg>.ts`:
 * the record and its type, then the record in the contract's `records`. A
 * package with `repo/` also gets the table and the row mapping. The contract
 * must exist, and it must not declare the record yet.
 */
export function addRecord(tree: Tree, options: RecordOptions): GroupChoice {
  const directory = `packages/${options.package}`;
  const contractFile = `${directory}/contract/${options.package}.ts`;
  if (!tree.exists(`${directory}/package.json`)) {
    throw new Error(`${directory} does not exist. Run \`nx g @tools/generators:package\` first.`);
  }
  if (!tree.exists(contractFile)) {
    throw new Error(
      `${contractFile} does not exist. Run \`nx g @tools/generators:package ${options.package} --sections=contract,...\` first.`,
    );
  }
  const name = names(options.name);
  const property = `${name.propertyName}Record`;
  const source = tree.read(contractFile, 'utf-8') ?? '';
  if (declaresConstant(source, property)) {
    throw new Error(
      `${contractFile} already declares \`${property}\`. Choose another record name.`,
    );
  }
  const group = chosenGroup(options);
  const values = groupValues(group);
  let next = insertBeforeContract(
    source,
    recordDeclaration(name.className, name.propertyName, values),
  );
  next = mergeNamedImport(next, '@repo/sync/contract/record', ['record'], false);
  next = mergeNamedImport(next, '@repo/sync/contract/record', ['RowOf'], true);
  next = mergeNamedImport(next, values.groupModule, [values.groupImport], false);
  next = addToArray(next, { property: 'records' }, property);
  tree.write(contractFile, next);
  addDependencies(tree, directory, { '@repo/sync': 'workspace:*' }, ['../sync']);
  if (tree.exists(`${directory}/drizzle.config.ts`)) {
    addTable(tree, options.package, options.name, group);
  } else {
    logger.info(
      `${directory} has no repo/, so no table was added. The record lives only in the object pool.`,
    );
  }
  return group;
}

/** A record in the contract, and its table when the package has `repo/`. */
export function recordGenerator(tree: Tree, options: RecordOptions) {
  addRecord(tree, options);
  return afterWrite(tree, true);
}
