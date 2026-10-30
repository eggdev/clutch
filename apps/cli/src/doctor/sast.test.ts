import { expect, test } from 'bun:test';

import type { ClutchConfig } from '@/clutch-config/schema';
import type { RuleResult } from '@/doctor/rules';
import { renderSast, sastPath } from '@/doctor/sast';

const config = (sast?: ClutchConfig['sast']) =>
  ({
    schemaVersion: 1,
    project: 'shop',
    template: { repo: 'acme/clutch', mode: 'sync' },
    capabilities: {},
    ...(sast ? { sast } : {}),
  }) as ClutchConfig;

const scanning = (outcome: RuleResult['outcome'], evidence: string) => (name: string) =>
  Promise.resolve(
    name === 'code_scanning'
      ? { outcome, evidence: [evidence] }
      : { outcome: 'unknown' as const, evidence: [] },
  );
const publicRepo = scanning('pass', 'public repository');
const noCodeSecurity = scanning('fail', 'private repository without GitHub Code Security');

test('auto runs CodeQL where code scanning takes results, and Semgrep elsewhere', async () => {
  expect(await sastPath(config(), publicRepo)).toMatchObject({
    choice: 'auto',
    engine: 'codeql',
    problem: null,
  });
  expect(await sastPath(config('auto'), noCodeSecurity)).toMatchObject({
    engine: 'semgrep',
    problem: null,
  });
});

test('without --remote, auto and codeql are unknown, and semgrep is known', async () => {
  const unknown = await sastPath(config('codeql'));
  expect(unknown).toMatchObject({ engine: null, problem: null });
  expect(renderSast(unknown)).toBe(
    'SAST: codeql -> ? (code scanning not checked without --remote)',
  );
  expect(await sastPath(config('semgrep'))).toMatchObject({ engine: 'semgrep', problem: null });
});

test('codeql on a private repository without Code Security is a problem', async () => {
  const path = await sastPath(config('codeql'), noCodeSecurity);
  expect(path.problem).toContain('sast is codeql');
  expect(renderSast(path)).toBe(
    'SAST: codeql -> fails (private repository without GitHub Code Security)',
  );
  expect(await sastPath(config('semgrep'), publicRepo)).toMatchObject({ engine: 'semgrep' });
});
