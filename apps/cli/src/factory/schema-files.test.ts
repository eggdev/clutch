import { expect, test } from 'bun:test';
import { readdir, readFile } from 'node:fs/promises';
import path from 'node:path';

import { schemaFiles } from '@/factory/schema-files';

const committed = path.resolve(import.meta.dir, '../../schemas/factory');

test('the committed JSON Schema files match the schemas in code', async () => {
  const expected = schemaFiles();
  const listed = await readdir(committed);
  const names = listed.toSorted();
  expect(names).toEqual(Object.keys(expected).toSorted());
  for (const name of names) {
    const file = JSON.parse(await readFile(path.join(committed, name), 'utf-8'));
    expect({ name, schema: file }).toEqual({ name, schema: expected[name] });
  }
  // On a failure, run: mise exec -- bun run clutch factory --write-schemas apps/cli/schemas/factory
});
