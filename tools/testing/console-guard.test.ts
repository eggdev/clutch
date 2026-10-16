import { expect, test } from 'bun:test';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { allowConsole, consoleMessage } from '@tools/testing/console-guard';

const guard = resolve(import.meta.dir, 'console-guard.ts');

/** Runs the test file source under the guard preload, and lists `pass name` or `fail name` per test. */
async function runGuarded(source: string): Promise<string[]> {
  const directory = await mkdtemp(join(tmpdir(), 'console-guard-'));
  try {
    await writeFile(join(directory, 'fixture.test.ts'), source);
    Bun.spawnSync(
      [
        process.execPath,
        'test',
        '--preload',
        guard,
        '--reporter=junit',
        '--reporter-outfile=report.xml',
        './fixture.test.ts',
      ],
      { cwd: directory },
    );
    const report = await Bun.file(join(directory, 'report.xml')).text();
    return [...report.matchAll(/<testcase name="([^"]+)"[^>]*?(\/>|>\s*<failure)/g)]
      .map((match) => `${match[2] === '/>' ? 'pass' : 'fail'} ${match[1]}`)
      .sort();
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
}

test('an unexpected error or warning fails its test, and an exact allowlist entry passes', async () => {
  expect(
    await runGuarded(
      [
        "import { test } from 'bun:test';",
        `import { allowConsole } from ${JSON.stringify(guard)};`,
        "test('unexpected error', () => { console.error('boom'); });",
        "test('unexpected warning', () => { console.warn('careful'); });",
        "test('allowed', () => { allowConsole('warn', 'retry 2 of 3'); console.warn('retry %d of %d', 2, 3); });",
        "test('allowed error object', () => { allowConsole('error', 'sync failed: TypeError: bad'); console.error('sync failed:', new TypeError('bad')); });",
        "test('other text', () => { allowConsole('warn', 'retry'); console.warn('retry 2 of 3'); });",
        "test('other level', () => { allowConsole('warn', 'boom'); console.error('boom'); });",
        "test('never logged', () => { allowConsole('error', 'boom'); });",
        "test('next test starts clean', () => { console.log('info is not guarded'); });",
      ].join('\n'),
    ),
  ).toEqual([
    'fail never logged',
    'fail other level',
    'fail other text',
    'fail unexpected error',
    'fail unexpected warning',
    'pass allowed',
    'pass allowed error object',
    'pass next test starts clean',
  ]);
});

test('the guard runs in this suite too', () => {
  allowConsole('warn', 'Error: from the repository suite');
  console.warn(new Error('from the repository suite'));
  expect(consoleMessage(['a %s', 'b', new RangeError('c')])).toBe('a b RangeError: c');
});
