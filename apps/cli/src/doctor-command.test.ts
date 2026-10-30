import { expect, test } from 'bun:test';
import path from 'node:path';

import { gitRepo } from '@/testing/git-repo';

const main = path.join(import.meta.dir, 'main.ts');

async function doctor(...args: Array<string>) {
  const proc = Bun.spawn([process.execPath, main, 'doctor', ...args], {
    stdout: 'pipe',
    stderr: 'pipe',
  });
  const [stdout, stderr, code] = await Promise.all([
    new Response(proc.stdout).text(),
    new Response(proc.stderr).text(),
    proc.exited,
  ]);
  return { stdout, stderr, code };
}

const config = [
  'schemaVersion: 1',
  'project: shop',
  'template: { repo: eggdev/clutch, mode: sync }',
  'capabilities:',
  '  root_agents_md: adopted',
  '  codeql_sast: { status: waived, reason: Lands in CL-102., issue: CL-102 }',
].join('\n');

test('--json reports every registry capability with its detected and declared state', async () => {
  await using repo = await gitRepo({
    'AGENTS.md': '# Agents\n',
    'clutch.yaml': config,
    '.clutch/lineage.json': JSON.stringify({ release: 'v0.2.0', files: {} }),
  });
  const result = await doctor('--root', repo.root, '--json');
  expect(result.code).toBe(0);
  const report = JSON.parse(result.stdout);
  expect(Object.keys(report)).toEqual([
    'schemaVersion',
    'root',
    'templateRelease',
    'registryCommit',
    'results',
    'summary',
  ]);
  expect(report).toMatchObject({ schemaVersion: 1, root: repo.root, templateRelease: 'v0.2.0' });
  expect(report.results).toHaveLength(36);
  const row = (id: string) => report.results.find((item: { id: string }) => item.id === id);
  expect(row('root_agents_md')).toEqual({
    id: 'root_agents_md',
    name: 'Root AGENTS.md',
    category: 'Agent context',
    phase: 'P0',
    level: 'core',
    detected: 'present',
    declared: 'adopted',
    reason: null,
    issue: null,
    until: null,
    evidence: ['AGENTS.md'],
  });
  expect(row('codeql_sast')).toMatchObject({
    detected: 'missing',
    declared: 'waived',
    reason: 'Lands in CL-102.',
    issue: 'CL-102',
  });
  expect(report.summary.declared).toEqual({ adopted: 1, waived: 1, 'n/a': 0, undeclared: 34 });
});

test('a repository without Clutch files reports every capability as undeclared', async () => {
  await using repo = await gitRepo({ 'package.json': '{}' });
  const result = await doctor('--root', repo.root);
  expect(result.code).toBe(0);
  const lines = result.stdout.trim().split('\n');
  expect(lines.filter((line) => line.startsWith('  '))).toHaveLength(36);
  expect(lines.at(-1)).toContain('Declared: 0 adopted, 0 waived, 0 n/a, 36 undeclared.');
});

test('--phase narrows the report, and a bad clutch.yaml exits 1 with its path', async () => {
  await using repo = await gitRepo({ 'clutch.yaml': config.replace('mode: sync', 'mode: copy') });
  const bad = await doctor('--root', repo.root);
  expect(bad).toMatchObject({
    code: 1,
    stderr: expect.stringContaining('clutch.yaml template.mode'),
  });

  await repo.write({ 'clutch.yaml': config });
  const p2 = await doctor('--root', repo.root, '--phase', 'P2', '--json');
  const { results } = JSON.parse(p2.stdout);
  expect(results.map((item: { id: string }) => item.id)).toEqual([
    'ai_review_blocking',
    'risk_tier_automerge',
  ]);
});
