import { expect, test } from 'bun:test';
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';

import { nativeBuild, recordName } from '@tools/native/build';
import type { Fingerprint, FingerprintTool } from '@tools/native/build';
import { poolHost } from '@tools/native/device-host';
import type { DeviceHost } from '@tools/native/device-host';
import { inRepo } from '@tools/testing/in-repo';

const mobile = { 'apps/mobile/package.json': JSON.stringify({ dependencies: { expo: '55.0.0' } }) };
const print = (hash: string, file = 'ios/Podfile'): Fingerprint => ({
  hash,
  sources: [{ id: file, filePath: file }],
});
const recorded = (fingerprint: Fingerprint) => ({
  [`apps/mobile/${recordName}`]: JSON.stringify({ ios: fingerprint }),
});

/** A promise of `value`, for a fake that answers at once. */
const now = <T>(value: T): Promise<T> => Promise.resolve(value);

/** A fingerprint tool that answers `fingerprint` for each platform. */
const tool = (fingerprint: Fingerprint) => (): Promise<FingerprintTool> =>
  now({ create: () => now(fingerprint) });

/** A host that records each build, and answers with `exitCode`. */
function fakeHost(exitCode = 0) {
  const builds: Array<string> = [];
  const host: DeviceHost = {
    name: 'fake',
    device: () => ({ exitCode: 0, output: '' }),
    build: (appRoot, platform) => {
      builds.push(`${path.basename(appRoot)} ${platform}`);
      return Promise.resolve({ exitCode, output: 'build output' });
    },
  };
  return { builds, host };
}

/** Runs `native:build` in a temporary repository and returns its exit code, log and record. */
function runBuild(files: Record<string, string>, args: Array<string>, options = {}) {
  return inRepo(files, async (root) => {
    const lines: Array<string> = [];
    const exitCode = await nativeBuild({
      root,
      args,
      log: (line) => lines.push(line),
      ...options,
    });
    const file = path.join(root, 'apps/mobile', recordName);
    const record = existsSync(file) ? JSON.parse(readFileSync(file, 'utf-8')) : null;
    return { exitCode, log: lines.join('\n'), record };
  });
}

test('a repository with no native app has nothing to build, and exits 0', async () => {
  const result = await runBuild({ 'apps/web/package.json': '{"dependencies":{"react":"19"}}' }, []);
  expect(result).toEqual({
    exitCode: 0,
    log: 'No native app in this repository. Nothing to build.',
    record: null,
  });
});

test('an unchanged fingerprint refuses the build as a JS-only change', async () => {
  const { builds, host } = fakeHost();
  const result = await runBuild({ ...mobile, ...recorded(print('a')) }, ['--platform', 'ios'], {
    host,
    tool: tool(print('a')),
  });
  expect(result.exitCode).toBe(1);
  expect(result.log).toContain('JS-only change');
  expect(result.log).toContain('not a native build');
  expect(builds).toEqual([]);
});

test('a changed fingerprint builds through the host, and records the new fingerprint', async () => {
  const { builds, host } = fakeHost();
  const result = await runBuild({ ...mobile, ...recorded(print('a')) }, ['--platform', 'ios'], {
    host,
    tool: tool(print('b', 'app.json')),
  });
  expect(result.exitCode).toBe(0);
  expect(builds).toEqual(['mobile ios']);
  expect(result.log).toContain('app.json');
  expect(result.log).toContain(`Commit apps/mobile/${recordName}`);
  expect(result.record.ios.hash).toBe('b');
});

test('a failed build keeps the last built fingerprint', async () => {
  const { host } = fakeHost(65);
  const result = await runBuild({ ...mobile, ...recorded(print('a')) }, ['--platform', 'ios'], {
    host,
    tool: tool(print('b')),
  });
  expect(result.exitCode).toBe(65);
  expect(result.record.ios.hash).toBe('a');
});

test('no recorded fingerprint asks for the first record, and --record writes it with no build', async () => {
  const { builds, host } = fakeHost();
  const missing = await runBuild(mobile, ['--platform', 'ios'], { host, tool: tool(print('a')) });
  expect(missing.exitCode).toBe(1);
  expect(missing.log).toContain('native:build mobile --record');
  const first = await runBuild(mobile, ['--record'], { host, tool: tool(print('a')) });
  expect(first.exitCode).toBe(0);
  expect([first.record.ios.hash, first.record.android.hash]).toEqual(['a', 'a']);
  expect(builds).toEqual([]);
});

test('an unknown flag, such as the removed --fresh, prints the usage line', async () => {
  const { builds, host } = fakeHost();
  const result = await runBuild(mobile, ['--platform', 'ios', '--fresh'], {
    host,
    tool: tool(print('a')),
  });
  expect(result.exitCode).toBe(1);
  expect(result.log).toContain('Usage: mise exec -- bun run native:build');
  expect(builds).toEqual([]);
});

test('the pool host refuses a build until CL-499, and keeps the last fingerprint', async () => {
  const result = await runBuild({ ...mobile, ...recorded(print('a')) }, ['--platform', 'ios'], {
    host: poolHost({ env: {} }),
    tool: tool(print('b')),
  });
  expect(result.exitCode).toBe(1);
  expect(result.log).toContain('makes no build yet');
  expect(result.record.ios.hash).toBe('a');
});

test('a missing platform is refused with the fix', async () => {
  const result = await runBuild({ ...mobile, ...recorded(print('a')) }, [], {
    tool: tool(print('b')),
  });
  expect(result.exitCode).toBe(1);
  expect(result.log).toContain('--platform ios');
});
