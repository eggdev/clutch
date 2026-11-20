import { afterEach, beforeEach, expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { checkScope, sourceList } from '@tools/check-scope';
import { observedTargets, validateTargets } from '@tools/validate';

let root = '';

function git(...args: Array<string>) {
  const run = Bun.spawnSync(['git', '-C', root, ...args]);
  if (run.exitCode !== 0) {
    throw new Error(run.stderr.toString());
  }
  return run.stdout.toString().trim();
}

async function write(file: string, content: string) {
  await mkdir(path.join(root, path.dirname(file)), { recursive: true });
  await writeFile(path.join(root, file), content);
}

beforeEach(async () => {
  root = await mkdtemp(path.join(tmpdir(), 'scope-'));
  git('init', '-q', '-b', 'main');
  git('config', 'user.email', 'test@example.com');
  git('config', 'user.name', 'Test');
  await write('a.txt', 'one\n');
  git('add', '-A');
  git('commit', '-qm', 'base');
});
afterEach(() => rm(root, { recursive: true, force: true }));

const limits = { max: 5, exclude: ['gen/**'] };

test('a PR compares its own head with its own base', async () => {
  await write('b.txt', 'x\n'.repeat(6));
  git('add', '-A');
  git('commit', '-qm', 'big');
  const base = git('rev-parse', 'HEAD');
  await write('c.txt', 'y\n');
  git('add', '-A');
  git('commit', '-qm', 'small');
  expect(checkScope(root, base, limits, git('rev-parse', 'HEAD'))).toEqual([]);
});

test('a change over the limit fails, and excluded files do not count', async () => {
  await write('b.txt', 'x\n'.repeat(6));
  await write('gen/c.txt', 'x\n'.repeat(50));
  git('add', '-A');
  expect(checkScope(root, 'HEAD', limits)).toEqual([
    'The PR changes 6 lines, over the limit of 5. Split it.',
  ]);
  git('rm', '-q', '--cached', 'b.txt');
  await rm(path.join(root, 'b.txt'));
  expect(checkScope(root, 'HEAD', limits)).toEqual([]);
});

test('the generated snapshot of a migration does not count, and its SQL does', async () => {
  await write('packages/x/repo/migrations/1_init/snapshot.json', '{}\n'.repeat(50));
  await write('packages/x/repo/migrations/1_init/migration.sql', 'select 1;\n'.repeat(5));
  git('add', '-A');
  expect(checkScope(root, 'HEAD', limits)).toEqual([]);
  await write('packages/x/repo/migrations/1_init/migration.sql', 'select 1;\n'.repeat(6));
  git('add', '-A');
  expect(checkScope(root, 'HEAD', limits)).toEqual([
    'The PR changes 6 lines, over the limit of 5. Split it.',
  ]);
});

test('a new screen needs an issue that states hand_test', async () => {
  await write('KICKOFF.md', '# Kickoff\n');
  git('add', '-A');
  git('commit', '-qm', 'kickoff');
  await write('features/a/screens/x.tsx', 'x\n');
  git('add', '-A');
  expect(checkScope(root, 'HEAD', limits)[0]).toContain('hand_test');
  await write('.clutch/issues/CL-1.md', '---\nhand_test: no\n---\n');
  git('add', '-A');
  expect(checkScope(root, 'HEAD', limits)).toEqual([]);
});

test('after kickoff, a new feature needs an issue with a goal from project intent', async () => {
  await write(
    'docs/contributing/project-intent.md',
    '| Teams | Share notes with a client |\nPlain prose here.\n',
  );
  git('add', '-A');
  git('commit', '-qm', 'intent');
  await write('features/b/x.ts', 'x\n');
  git('add', '-A');
  expect(checkScope(root, 'HEAD', limits)[0]).toContain('goal:');
  await write('.clutch/issues/CL-2.md', '---\ngoal: Share notes with a client\n---\n');
  git('add', '-A');
  expect(checkScope(root, 'HEAD', limits)).toEqual([]);
  await write('.clutch/issues/CL-2.md', '---\ngoal: Win a prize\n---\n');
  git('add', '-A');
  expect(checkScope(root, 'HEAD', limits)[0]).toContain('goal:');
});

test('a hand_test line in the body of an issue does not count', async () => {
  await write('KICKOFF.md', '# Kickoff\n');
  git('add', '-A');
  git('commit', '-qm', 'kickoff');
  await write('features/a/screens/x.tsx', 'x\n');
  await write('.clutch/issues/CL-1.md', '---\nid: CL-1\n---\n\nhand_test: yes\n');
  git('add', '-A');
  const errors = checkScope(root, 'HEAD', { ...limits, max: 100 });
  expect(errors).toHaveLength(1);
  expect(errors[0]).toContain('hand_test');
});

const quote = (list: Array<string>) => list.map((target) => `'${target}'`).join(', ');

/** Writes the lists. Each target runs `bun tools/<script>.ts`, by default its own name. */
async function lists(checks: Array<string>, observed: Array<string>, scripts = {}) {
  const command = (target: string) => ({
    options: { command: `bun tools/${(scripts as Record<string, string>)[target] ?? target}.ts` },
  });
  const targets = Object.fromEntries([...checks, ...observed].map((t) => [t, command(t)]));
  await write(
    'package.json',
    JSON.stringify({ nx: { targets: { ...targets, checks: { dependsOn: checks } } } }),
  );
  await write(
    'tools/validate.ts',
    `export const validateTargets = ['checks'];\nexport const observedTargets: Array<string> = [${quote(observed)}];\n`,
  );
}

function commit(message: string) {
  git('add', '-A');
  git('commit', '-qm', message);
}

const scope = () => checkScope(root, 'HEAD', { max: 100, exclude: [] });

const unobserved = (target: string) =>
  `The PR adds ${target} to a blocking list, and the base does not observe it. Add it to observedTargets in tools/validate.ts first. Only a rename that keeps the command of the old target skips that step. A split or a replacement does not.`;

test('a new blocking target fails unless the base observes it', async () => {
  await lists(['check-old'], []);
  commit('lists');
  await lists(['check-old', 'check-new'], []);
  expect(scope()).toEqual([unobserved('check-new')]);

  await lists(['check-old'], ['check-new']);
  commit('observe');
  await lists(['check-old', 'check-new'], []);
  expect(scope()).toEqual([]);
});

test('only a rename that keeps the command skips observe mode', async () => {
  await lists(['check-old'], []);
  commit('lists');
  await lists(['check-renamed'], [], { 'check-renamed': 'check-old' });
  expect(scope()).toEqual([]);
  await lists(['check-new'], []);
  expect(scope()).toEqual([unobserved('check-new')]);
  await lists(['check-a', 'check-b'], [], { 'check-a': 'check-old' });
  expect(scope()).toEqual([unobserved('check-b')]);
  await lists(['check-new'], ['check-old']);
  expect(scope()).toEqual([unobserved('check-new')]);
});

test('a blocking list that the head cannot read is a problem', async () => {
  await lists(['check-old'], []);
  commit('lists');
  await write('tools/validate.ts', 'const list = [];\nexport const validateTargets = list;\n');
  expect(scope()).toEqual([
    'check-scope cannot read validateTargets in tools/validate.ts at the head, so it cannot check new blocking targets. Write it as an array of strings.',
  ]);
});

test('the source reader skips comments and matches the exact name', () => {
  const source = [
    "export const validateTargetsOld = ['wrong'];",
    "/* export const validateTargets = ['commented']; */",
    'export const validateTargets: Array<string> = [ // a list ] with a bracket',
    "  'typecheck', /* ] */",
    "  'https://example.com', // keep",
    '];',
  ].join('\n');
  expect(sourceList(source, 'validateTargets')).toEqual(['typecheck', 'https://example.com']);
  expect(sourceList('export const validateTargets = list;', 'validateTargets')).toBeNull();
});

test('the source reader finds the lists of tools/validate.ts', () => {
  const source = readFileSync(path.join(import.meta.dir, 'validate.ts'), 'utf-8');
  expect(sourceList(source, 'validateTargets')).toEqual(validateTargets);
  expect(sourceList(source, 'observedTargets')).toEqual(observedTargets);
});
