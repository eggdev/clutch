import { expect, test } from 'bun:test';
import { readFile } from 'node:fs/promises';
import path from 'node:path';

import { detect } from '@/doctor/detect';
import { loadRegistry } from '@/doctor/registry';
import { gitRepo } from '@/testing/git-repo';

const root = path.resolve(import.meta.dir, '../../../..');

/** The template's own baseline: the status that `doctor --write-baseline` last recorded. */
const baseline = async (): Promise<Record<string, string>> =>
  JSON.parse(await readFile(path.join(root, '.clutch/doctor-baseline.json'), 'utf-8'));

test('the registry has unique ids, and the baseline holds each one', async () => {
  const registry = await loadRegistry(root);
  expect(registry.errors).toEqual([]);
  const ids = (registry.capabilities ?? []).map((entry) => entry.id);
  expect(new Set(ids).size).toBe(ids.length);
  expect(ids.toSorted()).toEqual(Object.keys(await baseline()).toSorted());
});

/**
 * A capability that detects without --remote must match the baseline. A remote
 * rule stays unknown here, and the baseline keeps its last remote result. When
 * a rule disagrees, fix the rule, or run doctor --write-baseline if the
 * template changed.
 */
test('each capability detected on the template matches the baseline', async () => {
  const registry = await loadRegistry(root);
  const found = await detect(root, registry.capabilities ?? []);
  const recorded = await baseline();
  const known = found.filter((item) => item.status !== 'unknown');
  const detected: Record<string, string | undefined> = Object.fromEntries(
    known.map((item) => [item.id, item.status]),
  );
  const expected: Record<string, string | undefined> = Object.fromEntries(
    known.map((item) => [item.id, recorded[item.id]]),
  );
  expect(detected).toEqual(expected);
});

test('a project CLI in a root script and a verify skill under its own name are detected', async () => {
  const registry = await loadRegistry(root);
  const wanted = (registry.capabilities ?? []).filter((entry) =>
    ['project_cli', 'verification_cli'].includes(entry.id),
  );
  await using repo = await gitRepo({
    'package.json': JSON.stringify({
      scripts: { 'control-shop': 'python3 .agents/skills/control-shop/scripts/control.py' },
    }),
    '.agents/skills/control-shop/verification.json': '{}',
    '.agents/skills/control-shop/scripts/verify.py': '',
    '.agents/skills/control-shop/features/README.md': '# Features\n',
  });
  const found = await detect(repo.root, wanted);
  expect(found.map((item) => [item.id, item.status])).toEqual([
    ['project_cli', 'present'],
    ['verification_cli', 'present'],
  ]);
});
