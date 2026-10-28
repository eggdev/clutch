import { expect, test } from 'bun:test';
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { checkManifests } from '@tools/lint/check-manifests';

const tagged = (kind: string) => JSON.stringify({ nx: { tags: [`type:${kind}`] } });

test('manifest policy rejects export maps and wrong type tags in packages and features, without inspecting dependencies or excluded apps', async () => {
  const directory = await mkdtemp(path.join(tmpdir(), 'neighborhood-manifest-rule-'));
  try {
    await writeFile(
      path.join(directory, 'package.json'),
      JSON.stringify({ workspaces: ['packages/*', 'features/*', 'apps/*', '!apps/archived'] }),
    );
    for (const folder of [
      'packages/new-package',
      'features/notes',
      'apps/archived',
      'node_modules/external',
    ]) {
      await mkdir(path.join(directory, folder), { recursive: true });
      await writeFile(
        path.join(directory, folder, 'package.json'),
        JSON.stringify({ exports: {} }),
      );
    }
    const first = await checkManifests(directory);
    expect(first.toSorted()).toEqual([
      'features/notes/package.json: needs exactly one Nx tag, type:feature. See docs/contributing/import-boundaries.md.',
      'features/notes/package.json: package exports are forbidden; use TypeScript path aliases to source files.',
      'packages/new-package/package.json: needs exactly one Nx tag, type:package or type:tool. See docs/contributing/import-boundaries.md.',
      'packages/new-package/package.json: package exports are forbidden; use TypeScript path aliases to source files.',
    ]);
    await writeFile(
      path.join(directory, 'packages/new-package/package.json'),
      JSON.stringify({ nx: { tags: ['type:package', 'type:tool'] } }),
    );
    await writeFile(path.join(directory, 'features/notes/package.json'), tagged('package'));
    const second = await checkManifests(directory);
    expect(second.toSorted()).toEqual([
      'features/notes/package.json: needs exactly one Nx tag, type:feature. See docs/contributing/import-boundaries.md.',
      'packages/new-package/package.json: needs exactly one Nx tag, type:package or type:tool. See docs/contributing/import-boundaries.md.',
    ]);
    await writeFile(path.join(directory, 'packages/new-package/package.json'), tagged('package'));
    await writeFile(path.join(directory, 'features/notes/package.json'), tagged('feature'));
    expect(await checkManifests(directory)).toEqual([]);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});
