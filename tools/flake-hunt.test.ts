import { expect, test } from 'bun:test';
import { readFile } from 'node:fs/promises';
import path from 'node:path';

import { entryFor, issueBody, newFlakes, tally } from '@tools/flake-hunt';
import { inRepo } from '@tools/testing/in-repo';

/** A test that fails on every third run. It counts its runs in a file, because --rerun-each reloads the module. */
const flipping = [
  "import { describe, expect, test } from 'bun:test';",
  "import { existsSync, readFileSync, writeFileSync } from 'node:fs';",
  'test(\'flips & "quotes"\', () => {',
  "  const n = existsSync('count') ? Number(readFileSync('count', 'utf-8')) + 1 : 1;",
  "  writeFileSync('count', String(n));",
  '  expect(n % 3).not.toBe(0);',
  '});',
  "test('stable', () => { expect(1).toBe(1); });",
  "describe('group', () => { test('always fails', () => { expect(1).toBe(2); }); });",
  '',
].join('\n');

test('a seeded flaky test is found in a real bun --rerun-each report, and a stable or broken one is not', async () => {
  const tallies = await inRepo({ 'flip.test.ts': flipping }, async (root) => {
    Bun.spawnSync(
      [
        process.execPath,
        'test',
        'flip.test.ts',
        '--rerun-each',
        '6',
        '--reporter=junit',
        '--reporter-outfile=out.xml',
      ],
      { cwd: root, stdout: 'pipe', stderr: 'pipe' },
    );
    return tally(await readFile(path.join(root, 'out.xml'), 'utf-8'));
  });
  expect(tallies.toSorted((a, b) => a.name.localeCompare(b.name))).toEqual([
    { file: 'flip.test.ts', name: 'always fails', passed: 0, failed: 6 },
    { file: 'flip.test.ts', name: 'flips & "quotes"', passed: 4, failed: 2 },
    { file: 'flip.test.ts', name: 'stable', passed: 6, failed: 0 },
  ]);
  expect(newFlakes(tallies, []).map((flake) => flake.name)).toEqual(['flips & "quotes"']);
});

test('a flake that the quarantine already holds is not added again', () => {
  const tallies = [{ file: 'a.test.ts', name: 'slow', passed: 18, failed: 2 }];
  const known = [
    { file: 'a.test.ts', name: 'slow', issue: 'CL-128', until: '2026-11-20', reason: 'x' },
  ];
  expect(newFlakes(tallies, known)).toEqual([]);
  expect(newFlakes(tallies, [])).toHaveLength(1);
});

test('a new flake gets a 14-day quarantine entry and an issue that names the run', () => {
  const flake = { file: 'a.test.ts', name: 'slow', passed: 18, failed: 2 };
  expect(entryFor(flake, 'CL-140', '2026-11-02', 'https://ci/run/1')).toEqual({
    file: 'a.test.ts',
    name: 'slow',
    issue: 'CL-140',
    until: '2026-11-16',
    reason:
      'The flake hunt on 2026-11-02 saw it fail 2 of 20 runs on the same code (https://ci/run/1).',
  });
  const body = issueBody(flake, 'https://ci/run/1');
  expect(body).toContain('It failed 2 times: https://ci/run/1');
  expect(body).toContain('mise exec -- bun test a.test.ts --rerun-each 20');
});
