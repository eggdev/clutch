import { expect, test } from 'bun:test';
import {
  chmodSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

// The script runs here with a fake `mise`, so no Xcode, Bun install or prebuild runs.
const script = path.join(import.meta.dir, 'ios-simulator-build.sh');
const revision = 'c3'.repeat(20);
const computed = 'a1'.repeat(20);

/** A build machine folder, a fake `mise` that logs each call, and a snapshot with one app. */
function machine() {
  const base = mkdtempSync(path.join(tmpdir(), 'ios-build-'));
  const bin = path.join(base, 'bin');
  mkdirSync(bin);
  const mise = path.join(bin, 'mise');
  writeFileSync(
    mise,
    `#!/usr/bin/env bash\necho "$*" >> "${base}/calls"\nif [ "$4" = "-e" ]; then echo ${computed}; fi\n`,
  );
  chmodSync(mise, 0o755);
  mkdirSync(path.join(base, 'snapshot/apps/mobile'), { recursive: true });
  const tar = Bun.spawnSync([
    'tar',
    '-cf',
    path.join(base, 'snapshot.tar'),
    '-C',
    path.join(base, 'snapshot'),
    '.',
  ]);
  expect(tar.success).toBe(true);
  return { base, root: path.join(base, 'root'), bin };
}

function build(at: ReturnType<typeof machine>, expected: string) {
  const child = Bun.spawnSync(['bash', script, at.root, 'mobile', revision, expected], {
    stdin: Bun.file(path.join(at.base, 'snapshot.tar')),
    env: { ...process.env, PATH: `${at.bin}:${process.env['PATH'] ?? ''}` },
  });
  const calls = existsSync(path.join(at.base, 'calls'))
    ? readFileSync(path.join(at.base, 'calls'), 'utf-8')
    : '';
  return {
    code: child.exitCode,
    stdout: child.stdout.toString(),
    stderr: child.stderr.toString(),
    calls,
  };
}

test('a fingerprint that is not 40 hex characters is refused with the usage', () => {
  const result = build(machine(), 'abc');
  expect(result.code).toBe(2);
  expect(result.stderr).toContain('REVISION FINGERPRINT');
});

test('a snapshot with another fingerprint stops before the prebuild, exits 76 and prints both', () => {
  const at = machine();
  const result = build(at, 'b2'.repeat(20));
  expect(result.code).toBe(76);
  expect(result.stderr).toContain(
    `The head commit has the native fingerprint ${computed}, not ${'b2'.repeat(20)}.`,
  );
  expect(result.stdout.trim().split('\n').at(-1)).toBe(computed);
  expect(result.calls).not.toContain('prebuild');
  expect(existsSync(path.join(at.root, 'build.lock'))).toBe(false);
});

test('a lock that a running process holds makes the build exit 75', () => {
  const at = machine();
  mkdirSync(path.join(at.root, 'build.lock'), { recursive: true });
  writeFileSync(path.join(at.root, 'build.lock/pid'), String(process.pid));
  const result = build(at, computed);
  expect(result.code).toBe(75);
  expect(result.stderr).toContain('Another build of this project runs on the build machine');
  expect(result.calls).toBe('');
});
