import { expect, test } from 'bun:test';
import { readFile } from 'node:fs/promises';
import path from 'node:path';

import { gitRepo } from '@/testing/git-repo';
import { copyList, install } from '@/testing/install';

test('a kept managed file stays, and the lineage records the Clutch copy it declined', async () => {
  await using template = await gitRepo({
    'clutch.files.yaml': copyList,
    'AGENTS.md': '#\n',
    'tools/check.ts': 'clutch\n',
  });
  await using project = await gitRepo(
    { 'package.json': '{}', 'tools/check.ts': 'ours\n' },
    { name: 'shop' },
  );
  await install(project.root, template.root, { keep: ['tools/check.ts'] });
  expect(await readFile(path.join(project.root, 'tools/check.ts'), 'utf-8')).toBe('ours\n');
  const lineage = JSON.parse(
    await readFile(path.join(project.root, '.clutch/lineage.json'), 'utf-8'),
  );
  expect(Object.keys(lineage.kept)).toEqual(['tools/check.ts']);
});

test('a merged seed file holds both copies between conflict markers, and the manifest lists it', async () => {
  await using template = await gitRepo({
    'clutch.files.yaml': copyList,
    'AGENTS.md': '# Clutch\n',
    'tools/check.ts': 'x\n',
  });
  await using project = await gitRepo(
    { 'package.json': '{}', 'AGENTS.md': '# Shop' },
    { name: 'shop' },
  );
  const { manifest } = await install(project.root, template.root, { merge: ['AGENTS.md'] });
  expect(await readFile(path.join(project.root, 'AGENTS.md'), 'utf-8')).toBe(
    '<<<<<<< project\n# Shop\n=======\n# Clutch\n>>>>>>> clutch\n',
  );
  expect(manifest).toMatchObject({ markers: ['AGENTS.md'] });
});

test('an answer for a file that needs no decision is refused', async () => {
  await using template = await gitRepo({
    'clutch.files.yaml': copyList,
    'AGENTS.md': '#\n',
    'tools/check.ts': 'x\n',
  });
  await using project = await gitRepo({ 'package.json': '{}' }, { name: 'shop' });
  await expect(install(project.root, template.root, { keep: ['README.md'] })).rejects.toThrow(
    'README.md needs no decision.',
  );
});
