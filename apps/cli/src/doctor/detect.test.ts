import { expect, test } from 'bun:test';
import path from 'node:path';

import { detect, trackedFiles } from '@/doctor/detect';
import { loadRegistry } from '@/doctor/registry';
import type { CapabilityEntry, Rule } from '@/doctor/registry';
import { gitRepo } from '@/testing/git-repo';

const entry = (id: string, rules: Array<Rule>, partialIf?: Array<Rule>): CapabilityEntry => ({
  id,
  name: id,
  category: 'Trust',
  phase: 'P0',
  level: 'core',
  effort: 'S',
  doc: `docs/contributing/capabilities/${id}.md`,
  detect: rules,
  ...(partialIf ? { partial_if: partialIf } : {}),
});

test('present, partial, missing and unknown follow the status rules, and git runs once', async () => {
  await using repo = await gitRepo({ 'AGENTS.md': '#\n', 'SECURITY.md': '#\n' });
  let lists = 0;
  const listFiles = (root: string) => {
    lists += 1;
    return trackedFiles(root);
  };
  const found = await detect(
    repo.root,
    [
      entry('all_pass', [{ file: 'AGENTS.md' }, { file: 'SECURITY.md' }]),
      entry('some_pass', [{ file: 'AGENTS.md' }, { file: 'nope' }]),
      entry('only_partial_if', [{ file: 'nope' }], [{ file: 'SECURITY.md' }]),
      entry('none_pass', [{ file: 'nope' }], [{ file: 'nope.too' }]),
      entry('all_unknown', [{ remote: 'branch_protection' }]),
    ],
    { listFiles },
  );
  expect(found.map((item) => [item.id, item.status])).toEqual([
    ['all_pass', 'present'],
    ['some_pass', 'partial'],
    ['only_partial_if', 'partial'],
    ['none_pass', 'missing'],
    ['all_unknown', 'unknown'],
  ]);
  expect(found[2].evidence).toEqual(['SECURITY.md']);
  expect(lists).toBe(1);
});

test('on the template tree the seed entries are present, present and missing', async () => {
  const root = path.resolve(import.meta.dir, '../../../..');
  const registry = await loadRegistry(root);
  expect(registry.errors).toEqual([]);
  const started = performance.now();
  const found = await detect(root, registry.capabilities ?? []);
  expect(performance.now() - started).toBeLessThan(1000);
  expect(found.map((item) => [item.id, item.status])).toEqual([
    ['root_agents_md', 'present'],
    ['codeowners', 'present'],
    ['codeql_sast', 'missing'],
  ]);
});
