import { expect, test } from 'bun:test';
import { mkdtemp, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';

import {
  changedPlan,
  checkTargets,
  escapeAnnotation,
  findingsDocument,
  observe,
  observedTargets,
  runManyArgs,
  runObserved,
  validateTargets,
} from '@tools/validate';

test('each run prints failing tasks in full', () => {
  expect(runManyArgs(['lint'])).toEqual([
    'run-many',
    '--outputStyle=static-failures-only',
    '-t',
    'lint',
  ]);
});

test('check runs a subset of validate', () => {
  expect(checkTargets.every((target) => validateTargets.includes(target))).toBe(true);
  expect(validateTargets).toContain('checks');
});

test('validate --changed runs everything without a base, and nothing for no change', () => {
  expect(changedPlan(null, null)).toEqual({ kind: 'full', steps: [runManyArgs(validateTargets)] });
  expect(changedPlan('abc', null).kind).toBe('full');
  expect(changedPlan('abc', [])).toEqual({ kind: 'none', steps: [] });
});

test('validate --changed runs only the root checks for a docs-only change', () => {
  expect(changedPlan('abc', ['docs/a.md', 'README.md', 'LICENSE'])).toEqual({
    kind: 'docs',
    steps: [runManyArgs(['checks'])],
  });
});

test('validate --changed runs the affected projects, then the root checks', () => {
  const plan = changedPlan('abc', ['apps/cli/src/main.ts', 'docs/a.md']);
  expect(plan.kind).toBe('affected');
  const [affected, checks] = plan.steps;
  expect(affected.slice(0, 3)).toEqual([
    'affected',
    '--base=abc',
    '--outputStyle=static-failures-only',
  ]);
  expect(affected).not.toContain('checks');
  // Every other validate target runs on the affected projects.
  expect(affected.slice(4)).toEqual(validateTargets.filter((target) => target !== 'checks'));
  expect(checks).toEqual(runManyArgs(['checks']));
});

test('validate --json lists each finding of each check that reported, with the exit code', () => {
  const finding = {
    id: 'check-file-size/over-limit',
    file: 'tools/large.ts',
    problem: '11 lines, limit 10.',
    fix: 'Split the file.',
  };
  expect(findingsDocument(1, { 'check-contract': [], 'check-file-size': [finding] })).toEqual({
    exitCode: 1,
    checks: ['check-contract', 'check-file-size'],
    missing: [],
    findings: [finding],
  });
});

test('validate --json names a check that wrote no findings as missing', () => {
  // A check that stops before the end writes no file. It did not find nothing.
  expect(findingsDocument(1, { 'check-file-size': [] })).toEqual({
    exitCode: 1,
    checks: ['check-file-size'],
    missing: ['check-contract'],
    findings: [],
  });
});

function fakeRun(target: string) {
  if (target === 'check-crash') {
    throw new Error('no such target');
  }
  if (target === 'check-killed') {
    return { signal: 'SIGKILL' };
  }
  return target === 'check-fake' ? 1 : 0;
}

const heading = 'Observed checks (they never block):';
const passed = 'The blocking checks passed, so validate exits with code 0.';

test('an observed check with a finding prints a warning, and validate still passes', () => {
  const lines: Array<string> = [];
  const targets = ['check-fake', 'check-clean', 'check-crash', 'check-killed'];
  // Outside CI. The test names it, so the form does not follow the machine that runs the test.
  expect(runObserved(0, targets, fakeRun, (line) => lines.push(line), false)).toBe(0);
  expect(lines).toEqual([
    heading,
    'Warning: check-fake would block: it exited with code 1. It is observed, so validate still passes.',
    'Warning: check-crash would block: it crashed: no such target. It is observed, so validate still passes.',
    'Warning: check-killed would block: the signal SIGKILL ended it. It is observed, so validate still passes.',
    passed,
  ]);
});

test('in CI an observed warning is an escaped annotation, and a blocking failure still fails', () => {
  const lines: Array<string> = [];
  expect(
    runObserved(
      1,
      ['check-a:b,c'],
      () => 1,
      (line) => lines.push(line),
      true,
    ),
  ).toBe(1);
  expect(lines[1]).toStartWith('::warning title=Observed check check-a%3Ab%2Cc::check-a:b,c would');
  expect(lines[2]).toBe('The blocking checks failed, so validate exits with code 1.');
  expect(escapeAnnotation('100% done\r\nnext')).toBe('100%25 done%0D%0Anext');
  expect(escapeAnnotation('a: b, c', true)).toBe('a%3A b%2C c');
});

test('with no observed targets, nothing runs and nothing prints', () => {
  const lines: Array<string> = [];
  const runs: Array<string> = [];
  const run = (target: string) => runs.push(target);
  expect(runObserved(0, [], run, (line) => lines.push(line))).toBe(0);
  expect([...runs, ...lines]).toEqual([]);
  expect(observedTargets.filter((target) => validateTargets.includes(target))).toEqual([]);
});

const nxTarget = (command: string) => ({
  executor: 'nx:run-commands',
  options: { command },
  cache: false,
});

test('validate runs a real observed target with Nx, and stops one at its limit', async () => {
  const root = await mkdtemp(path.join(tmpdir(), 'observe-'));
  try {
    await symlink(
      path.join(import.meta.dir, '..', 'node_modules'),
      path.join(root, 'node_modules'),
    );
    await writeFile(path.join(root, 'nx.json'), '{"neverConnectToCloud":true}');
    const targets = { 'check-fails': nxTarget('exit 3'), 'check-hangs': nxTarget('sleep 30') };
    await writeFile(
      path.join(root, 'package.json'),
      JSON.stringify({ name: 'fake', nx: { targets } }),
    );
    const env = { ...process.env, NX_DAEMON: 'false', GITHUB_ACTIONS: '' };
    const lines: Array<string> = [];
    const options = { targets: ['check-fails', 'check-hangs'], cwd: root, limitSeconds: 3 };
    expect(observe(0, env, options, (line) => lines.push(line))).toBe(0);
    expect(lines[1]).toContain('check-fails would block: it exited with code 1.');
    expect(lines[2]).toContain('check-hangs would block: it ran past the limit');
    expect(lines).toHaveLength(4);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
}, 30_000);
