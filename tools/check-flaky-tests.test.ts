import { expect, test } from 'bun:test';
import path from 'node:path';

import { checkFlakyTests } from '@tools/check-flaky-tests';
import { excludePattern, onlyPattern } from '@tools/flaky';
import type { FlakyTest } from '@tools/flaky';
import { inRepo } from '@tools/testing/in-repo';

const today = '2026-11-01';
const name = 'a sometimes slow thing finishes';

const entry = (more: Partial<FlakyTest> = {}): FlakyTest => ({
  file: 'tools/thing.test.ts',
  name,
  issue: 'CL-128',
  until: '2026-11-20',
  reason: 'Timed out once on CI.',
  ...more,
});

const issue = (status: string) =>
  `---\nid: CL-128\ntitle: 'Fix the thing'\nphase: P4\nstatus: ${status}\ndepends_on: []\npr: ''\nowner: agent\n---\n\n# CL-128\n`;

/** A repository with one test file, one issue and a registry of `entries`. */
function repo(entries: Array<FlakyTest>, status = 'todo') {
  return {
    'tools/thing.test.ts': `test('${name}', () => {});\ntest('another thing', () => {});\n`,
    '.clutch/issues/CL-128.md': issue(status),
    'tools/flaky-tests.json': JSON.stringify({ tests: entries }),
  };
}

test('an entry with an open issue, a reason and a near expiry passes', async () => {
  expect(await inRepo(repo([entry()]), (root) => checkFlakyTests(root, today))).toEqual([]);
  expect(await inRepo({}, (root) => checkFlakyTests(root, today))).toEqual([]);
});

test('an expired entry fails with the fix, and so does an expiry more than 30 days ahead', async () => {
  const [expired] = await inRepo(repo([entry({ until: '2026-10-31' })]), (root) =>
    checkFlakyTests(root, today),
  );
  expect(expired).toContain('the quarantine ended on 2026-10-31');
  expect(expired).toContain('Fix the test under CL-128 and remove the entry');
  const [far] = await inRepo(repo([entry({ until: '2026-12-15' })]), (root) =>
    checkFlakyTests(root, today),
  );
  expect(far).toContain('more than 30 days ahead. Pick a date no later than 2026-12-01');
});

test('an entry whose issue is missing or done fails', async () => {
  const [missing] = await inRepo(repo([entry({ issue: 'CL-129' })]), (root) =>
    checkFlakyTests(root, today),
  );
  expect(missing).toContain('CL-129 does not exist. File it with clutch issues new');
  const [done] = await inRepo(repo([entry()], 'done'), (root) => checkFlakyTests(root, today));
  expect(done).toContain('CL-128 is done, but the test is still quarantined');
});

test('a wrong name, a missing file, a non-bun file, a duplicate or a missing field fails', async () => {
  const problems = await inRepo(
    {
      ...repo([
        entry({ name: 'a renamed test' }),
        entry({ file: 'tools/gone.test.ts' }),
        entry({ file: 'tools/test_thing.py' }),
        entry(),
        entry(),
        { ...entry(), reason: '' },
      ]),
      'tools/test_thing.py': 'def test_thing(): pass\n',
    },
    (root) => checkFlakyTests(root, today),
  );
  expect(problems).toEqual([
    expect.stringContaining('"a renamed test": the file has no test with this exact name'),
    expect.stringContaining(
      'tools/gone.test.ts "a sometimes slow thing finishes": the file does not exist',
    ),
    expect.stringContaining('only bun test files can be quarantined'),
    expect.stringContaining('add reason. Each entry needs file, name, issue, until and reason.'),
    expect.stringContaining('is listed twice. Keep one.'),
    expect.stringContaining('is listed twice. Keep one.'),
  ]);
});

/** Runs `bun test` on the fixture file with a `-t` pattern, and returns the pass count. */
function passCount(root: string, pattern: string) {
  const result = Bun.spawnSync(
    [process.execPath, 'test', path.join(root, 'thing.test.ts'), '-t', pattern],
    {
      cwd: root,
      stdout: 'pipe',
      stderr: 'pipe',
    },
  );
  return /(\d+) pass/u.exec(result.stderr.toString())?.[1];
}

test('the patterns leave a quarantined test out of a run, and run it alone, also inside describe', async () => {
  const files = {
    'thing.test.ts': [
      "import { describe, expect, test } from 'bun:test';",
      "test('a (tricky) name: 50%?', () => { expect(1).toBe(1); });",
      "test('a stable test', () => { expect(1).toBe(1); });",
      "describe('group', () => { test('nested flake', () => { expect(1).toBe(1); }); });",
      '',
    ].join('\n'),
  };
  const flaky = [entry({ name: 'a (tricky) name: 50%?' }), entry({ name: 'nested flake' })];
  const pattern = excludePattern(flaky);
  expect(pattern).not.toBeNull();
  expect(excludePattern([])).toBeNull();
  const counts = await inRepo(files, (root) => [
    passCount(root, pattern ?? ''),
    passCount(root, onlyPattern(flaky[0])),
    passCount(root, onlyPattern(flaky[1])),
  ]);
  expect(counts).toEqual(['1', '1', '1']);
});
