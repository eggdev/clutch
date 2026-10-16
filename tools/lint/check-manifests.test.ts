import { expect, test } from 'bun:test';
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { checkManifests } from '@tools/lint/check-manifests';

const tagged = (kind: string) => JSON.stringify({ nx: { tags: [`type:${kind}`] } });

test('manifest policy rejects export maps and missing type tags in workspaces, without inspecting dependencies or excluded apps', async () => {
  const directory = await mkdtemp(path.join(tmpdir(), 'neighborhood-manifest-rule-'));
  try {
    await writeFile(
      path.join(directory, 'package.json'),
      JSON.stringify({ workspaces: ['packages/*', 'apps/*', '!apps/archived'] }),
    );
    for (const folder of ['packages/new-package', 'apps/archived', 'node_modules/external']) {
      await mkdir(path.join(directory, folder), { recursive: true });
      await writeFile(
        path.join(directory, folder, 'package.json'),
        JSON.stringify({ exports: {} }),
      );
    }
    expect(await checkManifests(directory)).toEqual([
      'packages/new-package/package.json: package exports are forbidden; use TypeScript path aliases to source files.',
      'packages/new-package/package.json: a package needs exactly one Nx tag, type:service or type:domain. See docs/contributing/import-boundaries.md.',
    ]);
    await writeFile(
      path.join(directory, 'packages/new-package/package.json'),
      JSON.stringify({ nx: { tags: ['type:service', 'type:domain'] } }),
    );
    expect(await checkManifests(directory)).toEqual([
      'packages/new-package/package.json: a package needs exactly one Nx tag, type:service or type:domain. See docs/contributing/import-boundaries.md.',
    ]);
    await writeFile(path.join(directory, 'packages/new-package/package.json'), tagged('service'));
    expect(await checkManifests(directory)).toEqual([]);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});
