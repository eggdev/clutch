import { expect, test } from 'bun:test';

import { trackedFiles } from '@/doctor/detect';
import type { Rule } from '@/doctor/registry';
import { context, evaluate } from '@/doctor/rules';
import { gitRepo } from '@/testing/git-repo';

const fixture = {
  'AGENTS.md': '# Agents\n',
  'apps/web/AGENTS.md': '# Web\n',
  '.agents/skills/x/AGENTS.md': '# Skill\n',
  'package.json': JSON.stringify({
    scripts: { validate: 'nx run-many' },
    nx: { targets: { 'check-ratchets': {} } },
  }),
  'packages/ui/project.json': JSON.stringify({ targets: { build: {} } }),
  'bunfig.toml': '[install]\nminimumReleaseAge = 259200\n',
  '.clutch/ratchets.json': JSON.stringify({ ratchets: { suppressions: 3 } }),
  '.github/workflows/ci.yml': [
    'on:',
    '  pull_request:',
    '  push:',
    'jobs:',
    '  validate:',
    '    steps:',
    '      - uses: actions/checkout@0123456789abcdef0123456789abcdef01234567',
    '      - uses: github/codeql-action/init@0123456789abcdef0123456789abcdef01234567',
    '      - run: bunx nx affected -t test',
  ].join('\n'),
  '.github/workflows/nightly.yml':
    'on: schedule\njobs:\n  a:\n    steps:\n      - uses: actions/checkout@v4\n',
};

async function check(rule: Rule): Promise<[string, Array<string>]> {
  await using repo = await gitRepo(fixture);
  await repo.write({ 'UNTRACKED.md': 'x', 'apps/api/AGENTS.md': 'not committed' });
  const result = await evaluate(rule, context(repo.root, await trackedFiles(repo.root)));
  return [result.outcome, result.evidence];
}

async function outcome(rule: Rule) {
  const [result] = await check(rule);
  return result;
}

test('file matches tracked files only, and honors min and exclude', async () => {
  expect(await check({ file: 'AGENTS.md' })).toEqual(['pass', ['AGENTS.md']]);
  expect(await check({ file: 'UNTRACKED.md' })).toEqual(['fail', []]);
  expect(await check({ file: '*/**/AGENTS.md', exclude: ['.agents/**'] })).toEqual([
    'pass',
    ['apps/web/AGENTS.md'],
  ]);
  expect(await check({ file: '**/AGENTS.md', min: 4 })).toEqual(['fail', []]);
});

test('grep finds a pattern in the matching tracked files', async () => {
  expect(await check({ grep: { files: 'bunfig.toml', pattern: 'minimumReleaseAge' } })).toEqual([
    'pass',
    ['bunfig.toml'],
  ]);
  expect(await check({ grep: { files: '*.md', pattern: 'nothing here' } })).toEqual(['fail', []]);
});

test('script and target read package.json and project.json', async () => {
  expect(await check({ script: 'validate' })).toEqual(['pass', ['package.json scripts.validate']]);
  expect(await check({ script: 'deploy' })).toEqual(['fail', []]);
  expect(await check({ target: 'check-ratchets' })).toEqual([
    'pass',
    ['package.json target check-ratchets'],
  ]);
  expect(await check({ target: 'build' })).toEqual([
    'pass',
    ['packages/ui/project.json target build'],
  ]);
});

test('workflow matches events, actions, run scripts and pinned refs', async () => {
  const ci: [string, Array<string>] = ['pass', ['.github/workflows/ci.yml']];
  expect(await check({ workflow: { uses: 'github/codeql-action/' } })).toEqual(ci);
  expect(await check({ workflow: { on: 'pull_request', run: 'nx affected' } })).toEqual(ci);
  expect(await check({ workflow: { pinned: true } })).toEqual(ci);
  expect(await check({ workflow: { on: 'schedule', pinned: true } })).toEqual(['fail', []]);
});

test('yaml finds a dotted path, and remote is unknown without --remote', async () => {
  expect(
    await check({ yaml: { file: '.clutch/ratchets.json', path: 'ratchets.suppressions' } }),
  ).toEqual(['pass', ['.clutch/ratchets.json ratchets.suppressions']]);
  expect(await check({ yaml: { file: '.clutch/ratchets.json', path: 'ratchets.files' } })).toEqual([
    'fail',
    [],
  ]);
  expect(await check({ remote: 'code_scanning_default_setup' })).toEqual([
    'unknown',
    ['remote code_scanning_default_setup not checked'],
  ]);
});

test('any ignores an unknown child, and all needs every child', async () => {
  const unknown: Rule = { remote: 'branch_protection' };
  expect(await outcome({ any: [unknown, { file: 'AGENTS.md' }] })).toBe('pass');
  expect(await outcome({ any: [unknown, { file: 'nope' }] })).toBe('fail');
  expect(await outcome({ any: [unknown] })).toBe('unknown');
  expect(await outcome({ all: [{ file: 'AGENTS.md' }, { script: 'validate' }] })).toBe('pass');
  expect(await outcome({ all: [{ file: 'AGENTS.md' }, { file: 'nope' }] })).toBe('fail');
  expect(await outcome({ all: [{ file: 'AGENTS.md' }, unknown] })).toBe('unknown');
});
