import { expect, test } from 'bun:test';
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';

import { nativeBuild, recordName } from '@tools/native/build';
import type { Fingerprint, FingerprintTool } from '@tools/native/build';
import { DeviceHostError, deviceHost, withDevice, withLock } from '@tools/native/device-host';
import type { DeviceHost, Platform } from '@tools/native/device-host';
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
function fakeHost(exitCode = 0, booted = true) {
  const builds: Array<string> = [];
  const host: DeviceHost = {
    name: 'fake',
    bootedDevice: (platform: Platform) =>
      Promise.resolve(booted ? { platform, id: 'booted-1', name: 'iPhone' } : null),
    install: () => Promise.resolve(),
    runFlow: () => Promise.resolve({ exitCode: 0, output: 'flow passed' }),
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
      lock: path.join(root, '.lock'),
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

test('the none host refuses a build, and names the kickoff setup', async () => {
  const result = await runBuild({ ...mobile, ...recorded(print('a')) }, ['--platform', 'ios'], {
    host: deviceHost({}),
    tool: tool(print('b')),
  });
  expect(result.exitCode).toBe(1);
  expect(result.log).toContain('No device host is set up');
  expect(result.record.ios.hash).toBe('a');
});

test('a missing platform or an unknown host is refused with the fix', async () => {
  const result = await runBuild({ ...mobile, ...recorded(print('a')) }, [], {
    tool: tool(print('b')),
  });
  expect(result.exitCode).toBe(1);
  expect(result.log).toContain('--platform ios');
  expect(() => deviceHost({ DEVICE_HOST: 'mac' })).toThrow('Use one of: none');
});

test('one session at a time holds the device lock, and a lock of an ended process is taken over', async () => {
  await inRepo({}, async (root) => {
    const file = path.join(root, 'device.lock');
    const inner = await withLock(file, async () => {
      const refused = await withLock(file, () => now('second')).catch(
        (error: Error) => error.message,
      );
      return refused;
    });
    expect(inner).toContain(`PID ${process.pid}`);
    expect(existsSync(file)).toBe(false);
    await Bun.write(file, JSON.stringify({ pid: 2_147_483_646, cwd: '/x', since: 'then' }));
    expect(await withLock(file, () => now('taken over'))).toBe('taken over');
  });
});

test('device work runs on the booted device, and no booted device is refused', async () => {
  await inRepo({}, async (root) => {
    const file = path.join(root, 'device.lock');
    const booted = fakeHost();
    expect(await withDevice(booted.host, 'ios', (device) => now(device.id), file)).toBe('booted-1');
    const none = fakeHost(0, false);
    const refusal = await withDevice(none.host, 'ios', () => now('ran'), file).catch(
      (error: unknown) => error,
    );
    expect(refusal).toBeInstanceOf(DeviceHostError);
    expect(String(refusal)).toContain('never creates, clones, boots or erases');
  });
});
