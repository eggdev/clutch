import path from 'node:path';

import type { Tree } from '@nx/devkit';
import { generateFiles, logger, names } from '@nx/devkit';
import { addDependencies, afterWrite, versionOf } from '@tools/generators/shared/workspace.ts';

export type ModelOptions = {
  readonly package: string;
  readonly name: string;
  /**
   * The sync group of each record: `org`, `user`, or `<kind>:<field>` such as
   * `space:spaceId`. The CLI requires it, so a model never syncs to the whole
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

/** The template values that write `groupsOf` and the group field of the record. */
function groupValues(choice: GroupChoice) {
  if (choice.field === null) {
    return {
      groupField: '',
      groupKind: 'org',
      groupHelper: 'organizationGroup',
      groupsOf: '(_, scope) => [organizationGroup(scope.organizationId)]',
      groupNote: 'Every actor in the organization gets them.',
    };
  }
  if (choice.kind === 'user') {
    return {
      groupField: choice.field,
      groupKind: 'user',
      groupHelper: 'userGroup',
      groupsOf: `(record) => [userGroup(record.${choice.field})]`,
      groupNote: `Only the user in \`${choice.field}\` gets each one.`,
    };
  }
  return {
    groupField: choice.field,
    groupKind: choice.kind,
    groupHelper: '',
    groupsOf: `(record) => [\`${choice.kind}:\${record.${choice.field}}\`]`,
    groupNote: `Only actors who load the \`${choice.kind}\` group in \`${choice.field}\` get each one. Use the helper of the package that owns \`${choice.kind}\` groups if it has one.`,
  };
}

/** The group of a model that a caller made without `--group`: the organization, with a warning. */
function chosenGroup(options: ModelOptions): GroupChoice {
  if (options.group === undefined) {
    logger.info(
      `${options.name} syncs to the whole organization. Pass --group to choose its sync group.`,
    );
    return organizationOnly;
  }
  return parseGroup(options.group);
}

const tableImports = "import { pgTable, text, timestamp } from 'drizzle-orm/pg-core';\n";

/** Writes only the record schema in `types/`, for a package without `models/`. */
export function addRecordSchema(
  tree: Tree,
  packageName: string,
  record: string,
  group: GroupChoice = organizationOnly,
) {
  const directory = `packages/${packageName}`;
  const name = names(record);
  if (tree.exists(`${directory}/types/${name.fileName}.ts`)) {
    throw new Error(`${directory}/types/${name.fileName}.ts already exists.`);
  }
  generateFiles(tree, path.join(import.meta.dirname, 'files', 'types'), `${directory}/types`, {
    ...name,
    ...groupValues(group),
    packageName,
    title: name.fileName.replaceAll('-', ' '),
  });
  addDependencies(tree, directory, { effect: versionOf(tree, 'effect') }, []);
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

/** Writes a record schema in `types/` and its model in `models/`, and returns its group. */
export function addModel(tree: Tree, options: ModelOptions): GroupChoice {
  const directory = `packages/${options.package}`;
  if (!tree.exists(`${directory}/package.json`)) {
    throw new Error(`${directory} does not exist. Run \`nx g @tools/generators:package\` first.`);
  }
  const name = names(options.name);
  if (tree.exists(`${directory}/types/${name.fileName}.ts`)) {
    throw new Error(`${directory}/types/${name.fileName}.ts already exists.`);
  }
  const group = chosenGroup(options);
  generateFiles(tree, path.join(import.meta.dirname, 'files'), directory, {
    ...name,
    ...groupValues(group),
    packageName: options.package,
    title: name.fileName.replaceAll('-', ' '),
  });
  addDependencies(
    tree,
    directory,
    { '@repo/sync': 'workspace:*', effect: versionOf(tree, 'effect') },
    ['../sync'],
  );
  return group;
}

/** A model, and its table when the package has `repo/`. */
export function modelGenerator(tree: Tree, options: ModelOptions) {
  const group = addModel(tree, options);
  if (tree.exists(`packages/${options.package}/drizzle.config.ts`)) {
    addTable(tree, options.package, options.name, group);
  } else {
    logger.info(
      `packages/${options.package} has no repo/, so no table was added. The record lives only in the object pool.`,
    );
  }
  return afterWrite(tree, true);
}
