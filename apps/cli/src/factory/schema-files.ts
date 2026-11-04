import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';

import { kinds } from '@/factory/kinds';

const dialect = 'https://json-schema.org/draft/2020-12/schema';

/**
 * The JSON Schema file of each kind, by file name. A Markdown kind's schema
 * checks its frontmatter. The rules across files, such as a runner that must
 * exist, are in `clutch factory --check` only.
 */
export function schemaFiles(): Record<string, unknown> {
  const files: Record<string, unknown> = {};
  for (const kind of kinds) {
    const { title, description, ...rest } = kind.schema;
    const about =
      kind.format === 'markdown'
        ? `${description} This schema checks the YAML frontmatter of ${kind.path}.`
        : description;
    files[`${kind.id}.schema.json`] = { $schema: dialect, title, description: about, ...rest };
  }
  return files;
}

/** Writes each JSON Schema file into `dir`, and returns the paths it wrote. */
export async function writeSchemaFiles(dir: string) {
  await mkdir(dir, { recursive: true });
  const written: Array<string> = [];
  for (const [name, schema] of Object.entries(schemaFiles())) {
    const file = path.join(dir, name);
    await writeFile(file, `${JSON.stringify(schema, null, 2)}\n`);
    written.push(file);
  }
  return written;
}
