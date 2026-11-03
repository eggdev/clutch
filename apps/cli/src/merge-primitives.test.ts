import { expect, test } from 'bun:test';

import { mergePrimitives } from '@/merge-primitives';

const project = [
  'version: 1',
  'primitives:',
  '  - id: repository-tools',
  '    name: Repository tools',
  '    code:',
  '      - tools/',
  '  - id: shop',
  '    name: Shop',
  '    code:',
  '      - packages/shop/',
  '',
].join('\n');

const shipped = [
  'version: 1',
  'primitives:',
  '  - id: repository-tools',
  '    code:',
  '      - tools/',
  '      - packages/journeys/',
  '  - id: notes',
  '    code:',
  '      - packages/notes/',
  '',
].join('\n');

test('a shipped folder joins the project primitive with the same id, and nothing else changes', () => {
  const merged = mergePrimitives(project, shipped, (folder) => folder === 'packages/journeys/');
  expect(merged.content).toBe(
    project.replace('      - tools/\n', '      - tools/\n      - packages/journeys/\n'),
  );
  expect(merged.conflicts).toEqual([]);
});

test('a folder that sync does not deliver, and a primitive the project lacks, are not added', () => {
  expect(mergePrimitives(project, shipped, () => false).content).toBe(project);
  expect(mergePrimitives(project, shipped, () => true).content).not.toContain('packages/notes/');
});

test('merging a second time changes nothing', () => {
  const once = mergePrimitives(project, shipped, () => true).content;
  expect(mergePrimitives(once, shipped, () => true).content).toBe(once);
});
