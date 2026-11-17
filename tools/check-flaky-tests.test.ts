import { expect, test } from 'bun:test';
import path from 'node:path';

import { baseTests, checkFlakyTests } from '@tools/check-flaky-tests';
import { bunTests, excludePattern, onlyPattern } from '@tools/flaky';
import type { FlakyTest, RemovedTest } from '@tools/flaky';
import { inRepo } from '@tools/testing/in-repo';

const today = '2026-11-01';
const name = 'a sometimes slow thing finishes';

const entry = (more: Partial<FlakyTest> = {}): FlakyTest => ({
  file: 'tools/thing.test.ts',
  name,
  issue: 'CL-128',
  since: '2026-10-25',
  until: '2026-11-20',
  reason: 'Timed out once on CI.',
  ...more,
});

const issue = (status: string) =>
  `---\nid: CL-128\ntitle: 'Fix the thing'\nphase: P4\nstatus: ${status}\ndepends_on: []\npr: ''\nowner: agent\n---\n\n# CL-128\n`;

/** A repository with one test file, one issue and a registry of `entries`. */
function repo(entries: Array<FlakyTest>, status = 'todo', removed: Array<RemovedTest> = []) {
  return {
    'tools/thing.test.ts': `test('${name}', () => {});\ntest('another thing', () => {});\n`,
    '.clutch/issues/CL-128.md': issue(status),
    'tools/flaky-tests.json': JSON.stringify({ tests: entries, removed }),
  };
}

test('an entry with an open issue, a reason and a near expiry passes', async () => {
  expect(await inRepo(repo([entry()]), (root) => checkFlakyTests(root, today))).toEqual([]);
  expect(await inRepo({}, (root) => checkFlakyTests(root, today))).toEqual([]);
});

test('an expired entry fails and names both ways out', async () => {
  const [expired] = await inRepo(repo([entry({ until: '2026-10-31' })]), (root) =>
    checkFlakyTests(root, today),
  );
  expect(expired).toContain('the quarantine ended on 2026-10-31, and it cannot be renewed');
  expect(expired).toContain('Fix the test under CL-128 and remove the entry');
  expect(expired).toContain('Or delete the test, and move the entry to "removed"');
});

test('an expiry 31 days after since, or a since in the future, fails', async () => {
  const [far] = await inRepo(repo([entry({ since: '2026-10-25', until: '2026-11-25' })]), (root) =>
    checkFlakyTests(root, today),
  );
  expect(far).toContain(
    'until 2026-11-25 is more than 30 days after since 2026-10-25. Pick a date no later than 2026-11-24',
  );
  expect(
    await inRepo(repo([entry({ since: '2026-10-25', until: '2026-11-24' })]), (root) =>
      checkFlakyTests(root, today),
    ),
  ).toEqual([]);
  const [future] = await inRepo(repo([entry({ since: '2026-11-02' })]), (root) =>
    checkFlakyTests(root, today),
  );
  expect(future).toContain('since 2026-11-02 is in the future');
});

test('a PR that moves the since of an entry on the base branch fails, so a quarantine is not renewed', async () => {
  const renewed = entry({ since: '2026-10-30', until: '2026-11-28' });
  const [moved] = await inRepo(repo([renewed]), (root) =>
    checkFlakyTests(root, today, [entry({ since: '2026-10-01', until: '2026-10-31' })]),
  );
  expect(moved).toContain(
    'since moved from 2026-10-01 to 2026-10-30. A quarantine cannot be renewed',
  );
  expect(await inRepo(repo([entry()]), (root) => checkFlakyTests(root, today, [entry()]))).toEqual(
    [],
  );
});

test('the base entries come from the registry at the base commit, and there are none without a base', async () => {
  const tests = await inRepo(repo([entry()]), (root) => {
    const git = (...args: Array<string>) =>
      Bun.spawnSync(['git', '-C', root, '-c', 'user.name=t', '-c', 'user.email=t@t', ...args]);
    git('init', '-q');
    git('add', '.');
    git('commit', '-qm', 'base');
    return [baseTests(root, 'HEAD'), baseTests(root, null)];
  });
  expect(tests).toEqual([[entry()], []]);
});

const removed = (more: Partial<RemovedTest> = {}): RemovedTest => ({
  file: 'tools/thing.test.ts',
  name: 'a deleted flake',
  removed: '2026-10-31',
  reason: 'It timed out 1 run in 20. A fake clock and a fresh port did not help.',
  issue: 'CL-128',
  ...more,
});

test('a removed test needs a reason, and must be gone from its file', async () => {
  expect(
    await inRepo(repo([], 'done', [removed()]), (root) => checkFlakyTests(root, today)),
  ).toEqual([]);
  const problems = await inRepo(
    repo([], 'done', [removed({ reason: '' }), removed({ name: 'another thing' })]),
    (root) => checkFlakyTests(root, today),
  );
  expect(problems).toEqual([
    expect.stringContaining('"a deleted flake": add reason. Each removed test needs'),
    expect.stringContaining('"another thing": the test is still in the file'),
  ]);
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
    expect.stringContaining('only bun test files and journey screenshots can be quarantined'),
    expect.stringContaining(
      'add reason. Each entry needs file, name, issue, since, until and reason.',
    ),
    expect.stringContaining('is listed twice. Keep one.'),
    expect.stringContaining('is listed twice. Keep one.'),
  ]);
});

test('a journey screenshot may be quarantined by its snap name, and leaves the bun test runs alone', async () => {
  const snapEntry = entry({ file: 'features/notes/journeys/notes-sync.pw.ts', name: 'notes-open' });
  expect(
    await inRepo(
      {
        ...repo([snapEntry]),
        'features/notes/journeys/notes-sync.pw.ts': "await snap(page, 'notes-open');\n",
      },
      (root) => checkFlakyTests(root, today),
    ),
  ).toEqual([]);
  expect(bunTests([snapEntry, entry()])).toEqual([entry()]);
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
