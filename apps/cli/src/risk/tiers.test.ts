import { expect, test } from 'bun:test';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { changeTier, classify, heldRules, journeysPresent, validateRiskConfig } from '@/risk/tiers';
import type { RiskConfig } from '@/risk/tiers';

const config: RiskConfig = {
  unmatched: 'high',
  rules: [
    { tier: 'low', paths: ['docs/**', '**/*.md'], except: [] },
    { tier: 'medium', paths: ['apps/**'], except: ['**/*.md'] },
    { tier: 'one-way-door', paths: ['.github/workflows/**', 'AGENTS.md'], except: [] },
  ],
};

const tierOf = (file: string) => classify(config, [file])[0];

test('the highest matching tier wins, whatever the rule order', () => {
  expect(tierOf('AGENTS.md')).toEqual({
    path: 'AGENTS.md',
    tier: 'one-way-door',
    pattern: 'AGENTS.md',
  });
  expect(tierOf('apps/web/src/app.ts')).toMatchObject({ tier: 'medium', pattern: 'apps/**' });
  expect(tierOf('docs/guide.md')).toMatchObject({ tier: 'low' });
});

test('except keeps a file out of its rule, so a lower rule decides', () => {
  expect(tierOf('apps/web/README.md')).toMatchObject({ tier: 'low', pattern: '**/*.md' });
});

test('a file that no rule matches gets the unmatched tier and no pattern', () => {
  expect(tierOf('vite.config.ts')).toEqual({ path: 'vite.config.ts', tier: 'high' });
});

test('a change takes the highest tier of its files, and an empty change is low', () => {
  expect(changeTier(classify(config, ['docs/a.md', 'apps/web/src/app.ts']))).toBe('medium');
  expect(changeTier(classify(config, ['docs/a.md', '.github/workflows/ci.yml']))).toBe(
    'one-way-door',
  );
  expect(changeTier([])).toBe('low');
});

test('the validator names the path of each bad value', () => {
  const { config: parsed, errors } = validateRiskConfig({
    schemaVersion: 1,
    unmatched: 'severe',
    rules: [{ tier: 'low', paths: 'docs/**', colour: 'red' }],
  });
  expect(parsed).toBeUndefined();
  expect(errors).toEqual([
    { path: 'unmatched', message: 'Expected low, medium, high, one-way-door.' },
    { path: 'rules.0.colour', message: 'Unknown key.' },
    { path: 'rules.0.paths', message: 'Expected a list of globs.' },
  ]);
});

test('a valid config fills in an empty except list', () => {
  const { config: parsed } = validateRiskConfig({
    schemaVersion: 1,
    unmatched: 'medium',
    rules: [{ tier: 'one-way-door', guardrails: 'tools/guardrail-files.json' }],
  });
  expect(parsed).toEqual({
    unmatched: 'medium',
    rules: [
      { tier: 'one-way-door', paths: [], except: [], guardrails: 'tools/guardrail-files.json' },
    ],
  });
});

test('a lines rule matches a file only by a changed line, and a file with no diff matches', () => {
  const lines: RiskConfig = {
    unmatched: 'medium',
    rules: [
      {
        tier: 'one-way-door',
        paths: ['.github/workflows/**'],
        except: [],
        lines: ['^\\s*permissions:'],
      },
    ],
  };
  const changed = new Map([
    ['.github/workflows/a.yml', ['    steps:']],
    ['.github/workflows/b.yml', ['permissions:']],
  ]);
  const files = ['.github/workflows/a.yml', '.github/workflows/b.yml', '.github/workflows/c.yml'];
  expect(classify(lines, files, changed).map((file) => file.tier)).toEqual([
    'medium',
    'one-way-door',
    'one-way-door',
  ]);
});

const linesRule = (lines: unknown) => ({
  schemaVersion: 1,
  unmatched: 'medium',
  rules: [{ tier: 'low', paths: ['a'], lines }],
});

test('lines must be a list of valid regular expressions', () => {
  expect(validateRiskConfig(linesRule(['('])).errors).toEqual([
    { path: 'rules.0.lines', message: 'Expected a list of regular expressions.' },
  ]);
  expect(validateRiskConfig(linesRule(['^a'])).config?.rules[0].lines).toEqual(['^a']);
});

test('a rule with journeys holds until each one exists', () => {
  const rule = { journeys: ['sign-in', 'sign-up'] };
  const plain = {};
  expect(heldRules([rule, plain], new Set(['sign-in']))).toEqual([rule, plain]);
  expect(heldRules([rule, plain], new Set(['sign-in', 'sign-up']))).toEqual([plain]);
});

test('journeysPresent names each file and its Core line', async () => {
  const root = await mkdtemp(path.join(tmpdir(), 'risk-journeys-'));
  try {
    await mkdir(path.join(root, 'features/a/journeys'), { recursive: true });
    await writeFile(
      path.join(root, 'features/a/journeys/first-visit.pw.ts'),
      '/**\n * Core: sign-up\n */\n',
    );
    expect([...journeysPresent(root)].toSorted()).toEqual(['first-visit', 'sign-up']);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
