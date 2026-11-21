import { expect, test } from 'bun:test';
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';

import { nativeBuild, recordName } from '@tools/native/build';
import type { Fingerprint, FingerprintTool } from '@tools/native/build';
import { installedOn, poolHost } from '@tools/native/device-host';
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

const bound = '/tmp/t3/devices/lease-1/agent-device';
const opened = { AGENT_DEVICE: bound };

/** A pool host on a fake bound command, and a fake build. Each keeps its calls in `calls`. */
function fakes(env: NodeJS.ProcessEnv = opened) {
  const calls: Array<string> = [];
  const host = poolHost({
    env,
    exists: (file) => file === bound,
    run: (_, args) => {
      calls.push(args.join(' '));
      return { exitCode: 0, output: '' };
    },
  });
  const build = (request: { root: string; app: string; fingerprint: string }) => {
    calls.push(`build ${request.app} ${request.fingerprint}`);
    return now(path.join(request.root, 'tmp/native', request.fingerprint, 'App.app'));
  };
  return { build, calls, host };
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
    const host = poolHost({ env: opened, exists: () => true });
    return { exitCode, log: lines.join('\n'), record, installed: installedOn(root, host) };
  });
}

test('a repository with no native app has nothing to build, and exits 0', async () => {
  const result = await runBuild({ 'apps/web/package.json': '{"dependencies":{"react":"19"}}' }, []);
  expect(result).toEqual({
    exitCode: 0,
    log: 'No native app in this repository. Nothing to build.',
    record: null,
    installed: null,
  });
});

test('--install with no device refuses before the build', async () => {
  const { build, calls, host } = fakes({});
  const result = await runBuild(mobile, ['--platform', 'ios', '--install'], {
    host,
    build,
    tool: tool(print('a')),
  });
  expect(result.exitCode).toBe(1);
  expect(result.log).toContain('`AGENT_DEVICE` is not set');
  expect(calls).toEqual([]);
});

test('a changed fingerprint finds the build, and writes the new record', async () => {
  const { build, calls, host } = fakes();
  const result = await runBuild({ ...mobile, ...recorded(print('a')) }, ['--platform', 'ios'], {
    host,
    build,
    tool: tool(print('b', 'app.json')),
  });
  expect(result.exitCode).toBe(0);
  expect(calls).toEqual(['build mobile b']);
  expect(result.log).toContain('app.json');
  expect(result.log).toContain(`Commit apps/mobile/${recordName}`);
  expect(result.log).toContain('The ios build of fingerprint b is at tmp/native/b/App.app.');
  expect(result.record.ios.hash).toBe('b');
  expect(result.installed).toBeNull();
});

test('an unchanged fingerprint writes no record, and still gives the app', async () => {
  const { build, calls, host } = fakes();
  const result = await runBuild({ ...mobile, ...recorded(print('a')) }, ['--platform', 'ios'], {
    host,
    build,
    tool: tool(print('a', 'app.json')),
  });
  expect(result.exitCode).toBe(0);
  expect(calls).toEqual(['build mobile a']);
  expect(result.log).not.toContain('Commit');
  expect(result.log).toContain('tmp/native/a/App.app');
  expect(result.record.ios.sources[0].id).toBe('ios/Podfile');
});

test('--install puts the built app on the device, and records it for the device', async () => {
  const { build, calls, host } = fakes();
  const result = await runBuild(mobile, ['--platform', 'ios', '--install'], {
    host,
    build,
    tool: tool(print('c')),
  });
  expect(result.exitCode).toBe(0);
  expect(calls[0]).toBe('build mobile c');
  expect(calls[1]).toEndWith('/tmp/native/c/App.app');
  expect(calls[1]).toStartWith('install ');
  expect(result.record.ios.hash).toBe('c');
  expect(result.installed).toEqual({ fingerprint: 'c' });
  expect(result.log).toContain('Installed the build of fingerprint c on the opened device.');
});

test('--record writes the fingerprints with no build', async () => {
  const { build, calls } = fakes();
  const first = await runBuild(mobile, ['--record'], { build, tool: tool(print('a')) });
  expect(first.exitCode).toBe(0);
  expect([first.record.ios.hash, first.record.android.hash]).toEqual(['a', 'a']);
  expect(calls).toEqual([]);
});

test('an unknown flag, such as the removed --fresh, prints the usage line', async () => {
  const { build, calls } = fakes();
  const result = await runBuild(mobile, ['--platform', 'ios', '--fresh'], {
    build,
    tool: tool(print('a')),
  });
  expect(result.exitCode).toBe(1);
  expect(result.log).toContain('Usage: mise exec -- bun run native:build');
  expect(calls).toEqual([]);
});

test('a missing platform is refused with the fix', async () => {
  const result = await runBuild({ ...mobile, ...recorded(print('a')) }, [], {
    tool: tool(print('b')),
  });
  expect(result.exitCode).toBe(1);
  expect(result.log).toContain('--platform ios');
});
