import { expect, test } from 'bun:test';
import path from 'node:path';

import { loadRegistry } from '@/doctor/registry';
import { cliRoot } from '@/format';
import { gitRepo } from '@/testing/git-repo';

const main = path.join(import.meta.dir, 'main.ts');

/** The capabilities that doctor reports: the registry of this checkout, not a fixed count. */
async function capabilities() {
  const registry = await loadRegistry(cliRoot);
  return registry.capabilities ?? [];
}

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
    'sast',
    'rulesets',
  ]);
  expect(report).toMatchObject({ schemaVersion: 1, root: repo.root, templateRelease: 'v0.2.0' });
  const all = await capabilities();
  expect(report.results).toHaveLength(all.length);
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
  expect(report.summary.declared).toEqual({
    adopted: 1,
    waived: 1,
    'n/a': 0,
    undeclared: all.length - 2,
  });
  expect(report.sast).toMatchObject({ choice: 'auto', engine: null, problem: null });
  expect(report.rulesets).toBeNull();
});

test('a repository without Clutch files reports every capability as undeclared', async () => {
  await using repo = await gitRepo({ 'package.json': '{}' });
  const result = await doctor('--root', repo.root);
  expect(result.code).toBe(0);
  const lines = result.stdout.trim().split('\n');
  const all = await capabilities();
  const count = all.length;
  expect(lines.filter((line) => line.startsWith('  '))).toHaveLength(count);
  expect(lines.at(-2)).toContain(`Declared: 0 adopted, 0 waived, 0 n/a, ${count} undeclared.`);
  expect(lines.at(-1)).toBe('SAST: auto -> ? (code scanning not checked without --remote)');
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
  const all = await capabilities();
  const p2ids = all.filter((entry) => entry.phase === 'P2').map((entry) => entry.id);
  expect(p2ids.length).toBeGreaterThan(0);
  expect(results.map((item: { id: string }) => item.id)).toEqual(p2ids);
});

const coreConfig = [
  config,
  'coreJourneys:',
  '  sign-up: adopted',
  '  sign-in: adopted',
  '  onboarding: { status: n/a, reason: The product has no setup step. }',
  '  profile-management: { status: n/a, reason: Kickoff has not run. }',
  '  billing-and-checkout: { status: n/a, reason: The product has no paid plan. }',
  '  roles-and-access: { status: n/a, reason: Each account has one user. }',
  '  account-security: { status: n/a, reason: Kickoff has not run. }',
  '  contact-support: { status: n/a, reason: Kickoff has not run. }',
  'budgets:',
  '  layoutShift: 0.01',
  '  clicks: { sign-up: 3, sign-in: 3 }',
  '  timeToValue: { event: first-note, seconds: 60 }',
].join('\n');

const signUpJourney = '/**\n * sign-up: A visitor makes an account.\n * Core: sign-up\n */\n';

test('--check fails for an adopted core journey that no journey proves', async () => {
  await using repo = await gitRepo({
    'clutch.yaml': coreConfig,
    'features/account/journeys/sign-up.pw.ts': signUpJourney,
  });
  const result = await doctor('--root', repo.root, '--check');
  expect(result.code).toBe(1);
  const missing = result.stdout.split('\n').filter((line) => line.startsWith('core journey'));
  expect(missing).toEqual([
    'core journey missing: sign-in is adopted in clutch.yaml, but no journey has `Core: sign-in`. Add features/<feature>/journeys/<id>.pw.ts from .agents/skills/setup-verification/references/core-journeys/sign-in.md, or record it as n/a with a reason. See docs/contributing/journeys/core.md.',
  ]);
});

test('--check passes the core journeys when each adopted one has a journey', async () => {
  await using repo = await gitRepo({
    'clutch.yaml': coreConfig,
    'features/account/journeys/sign-up.pw.ts': signUpJourney,
    'features/account/journeys/sign-in.maestro.yaml':
      '# sign-in: A member signs in on a phone.\n# Core: sign-in\nappId: com.example\n',
  });
  const result = await doctor('--root', repo.root, '--check');
  expect(result.stdout).not.toContain('core journey missing');
  expect(result.stdout).not.toContain('budget missing');
});

test('--check fails after kickoff when screens ship and clutch.yaml records no core journeys', async () => {
  await using repo = await gitRepo({ 'clutch.yaml': config });
  const empty = await doctor('--root', repo.root, '--check');
  expect(empty.stdout).not.toContain('core journeys unrecorded');
  await repo.write({ 'features/account/screens/home.tsx': 'export {};\n' });
  const done = await doctor('--root', repo.root, '--check');
  expect(done.code).toBe(1);
  expect(done.stdout).toContain(
    'core journeys unrecorded: kickoff is done and features have screens, but clutch.yaml has no `coreJourneys`',
  );
  await repo.write({ 'KICKOFF.md': '# Kickoff\n' });
  const before = await doctor('--root', repo.root, '--check');
  expect(before.stdout).not.toContain('core journeys unrecorded');
});

test('--check asks for no budget when no core journey is adopted', async () => {
  const none = coreConfig
    .replace('  sign-up: adopted', '  sign-up: { status: n/a, reason: Invite only. }')
    .replace('  sign-in: adopted', '  sign-in: { status: n/a, reason: Invite only. }')
    .replace(/budgets:[\s\S]*$/u, '');
  await using repo = await gitRepo({ 'clutch.yaml': none });
  const result = await doctor('--root', repo.root, '--check');
  expect(result.stdout).not.toContain('budget missing');
});

test('--check fails for a budget that the adopted core journeys need', async () => {
  await using repo = await gitRepo({
    'clutch.yaml': coreConfig.replace(
      '  clicks: { sign-up: 3, sign-in: 3 }\n',
      '  clicks: { sign-up: 3 }\n',
    ),
    'features/account/journeys/sign-up.pw.ts': signUpJourney,
  });
  const result = await doctor('--root', repo.root, '--check');
  expect(result.code).toBe(1);
  expect(result.stdout.split('\n').filter((line) => line.startsWith('budget missing'))).toEqual([
    'budget missing: budgets.clicks.sign-in is not set in clutch.yaml, and the adopted core journeys need it. See docs/contributing/journeys/core.md.',
  ]);
});
