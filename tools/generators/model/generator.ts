import path from 'node:path';

import type { Tree } from '@nx/devkit';
import { generateFiles, logger, names } from '@nx/devkit';
import { addDependencies, afterWrite, versionOf } from '@tools/generators/shared/workspace.ts';

export type ModelOptions = { readonly package: string; readonly name: string };

const tableImports = "import { pgTable, text, timestamp } from 'drizzle-orm/pg-core';\n";

/** Writes only the record schema in `types/`, for a package without `models/`. */
export function addRecordSchema(tree: Tree, packageName: string, record: string) {
  const directory = `packages/${packageName}`;
  const name = names(record);
  if (tree.exists(`${directory}/types/${name.fileName}.ts`)) {
    throw new Error(`${directory}/types/${name.fileName}.ts already exists.`);
  }
  generateFiles(tree, path.join(import.meta.dirname, 'files', 'types'), `${directory}/types`, {
    ...name,
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
export function addTable(tree: Tree, packageName: string, record: string) {
  const directory = `packages/${packageName}`;
  const name = names(record);
  const title = name.fileName.replaceAll('-', ' ');
  const tableName = `${name.propertyName}Records`;
  const schemaFile = `${directory}/repo/schema.ts`;
  const table = [
    '',
    `/** The owner records of ${title}. Each one belongs to one organization. */`,
    `export const ${tableName} = pgTable('${name.fileName.replaceAll('-', '_')}', {`,
    "  id: text('id').primaryKey(),",
    "  organizationId: text('organization_id').notNull(),",
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
    packageName,
    title,
  });
}

/** Writes a record schema in `types/` and its model in `models/`. */
export function addModel(tree: Tree, options: ModelOptions) {
  const directory = `packages/${options.package}`;
  if (!tree.exists(`${directory}/package.json`)) {
    throw new Error(`${directory} does not exist. Run \`nx g @tools/generators:package\` first.`);
  }
  const name = names(options.name);
  if (tree.exists(`${directory}/types/${name.fileName}.ts`)) {
    throw new Error(`${directory}/types/${name.fileName}.ts already exists.`);
  }
  generateFiles(tree, path.join(import.meta.dirname, 'files'), directory, {
    ...name,
    packageName: options.package,
    title: name.fileName.replaceAll('-', ' '),
  });
  addDependencies(
    tree,
    directory,
    { '@repo/sync': 'workspace:*', effect: versionOf(tree, 'effect') },
    ['../sync'],
  );
}

/** A model, and its table when the package has `repo/`. */
export function modelGenerator(tree: Tree, options: ModelOptions) {
  addModel(tree, options);
  if (tree.exists(`packages/${options.package}/drizzle.config.ts`)) {
    addTable(tree, options.package, options.name);
  } else {
    logger.info(
      `packages/${options.package} has no repo/, so no table was added. The record lives only in the object pool.`,
    );
  }
  return afterWrite(tree, true);
}
