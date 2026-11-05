import { expect, test } from 'bun:test';
import path from 'node:path';

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
  '.clutch/ratchets.json': JSON.stringify({ ratchets: { suppressions: 3 }, empty: {} }),
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

test('yaml does not count an empty value', async () => {
  expect(await check({ yaml: { file: '.clutch/ratchets.json', path: 'empty' } })).toEqual([
    'fail',
    [],
  ]);
});

/** The files of a factory fixture, under `prefix` in a repository. */
async function factoryFixture(name: string, prefix: string) {
  const dir = path.join(import.meta.dir, '../factory/fixtures', name);
  const files: Record<string, string> = {};
  for (const file of new Bun.Glob('**/*').scanSync({ cwd: dir })) {
    files[path.posix.join(prefix, file)] = await Bun.file(path.join(dir, file)).text();
  }
  return files;
}

async function factory(files: Record<string, string>) {
  await using repo = await gitRepo(files);
  const ctx = context(repo.root, await trackedFiles(repo.root));
  // Await here: the repository is removed when the function returns.
  return await Promise.all([
    evaluate({ factory: 'agents' }, ctx),
    evaluate({ factory: 'check' }, ctx),
  ]);
}

test('factory finds the agent files and runs the check on the tree', async () => {
  const [agents, passes] = await factory(await factoryFixture('good', 'factory'));
  expect(agents).toEqual({
    outcome: 'pass',
    evidence: [
      'factory/agents/implement/agent.md',
      'factory/agents/review/agent.md',
      'factory/agents/triage/agent.md',
    ],
  });
  expect(passes).toEqual({ outcome: 'pass', evidence: ['clutch factory --check passes'] });

  const broken = await factory(await factoryFixture('missing-runner', 'factory'));
  expect(broken.map((result) => result.outcome)).toEqual(['pass', 'fail']);
  expect(broken[1].evidence).toEqual(['clutch factory --check finds 1 problem']);

  expect(await factory({ 'AGENTS.md': '# Agents\n' })).toEqual([
    { outcome: 'fail', evidence: [] },
    { outcome: 'fail', evidence: [] },
  ]);
});

test('factory reads the tree root from clutch.yaml', async () => {
  const config = [
    'schemaVersion: 1',
    'project: shop',
    'template: { repo: eggdev/clutch, mode: sync }',
    'capabilities: {}',
    'factory: { root: . }',
  ].join('\n');
  const results = await factory({ 'clutch.yaml': config, ...(await factoryFixture('good', '')) });
  expect(results.map((result) => result.outcome)).toEqual(['pass', 'pass']);
  expect(results[0].evidence).toContain('agents/implement/agent.md');

  const invalid = await factory({ 'clutch.yaml': 'schemaVersion: 2\n' });
  expect(invalid[0]).toEqual({ outcome: 'unknown', evidence: ['clutch.yaml is not valid'] });
});
