import { expect, test } from 'bun:test';

import { DeviceHostError, ciHost, deviceHost, localHost } from '@tools/native/device-host';
import type { Run } from '@tools/native/device-host';
import { inRepo } from '@tools/testing/in-repo';

/** A runner that answers each command from `answers`, by its first words, and keeps the commands. */
function fakeRun(answers: Record<string, string>) {
  const commands: Array<string> = [];
  const run: Run = (command) => {
    const line = command.join(' ');
    commands.push(line);
    const key = Object.keys(answers).find((prefix) => line.startsWith(prefix));
    return Promise.resolve({
      exitCode: key ? 0 : 1,
      output: key ? (answers[key] ?? '') : 'unknown',
    });
  };
  return { run, commands };
}

test('DEVICE_HOST=ci gives the ci host', () => {
  expect(deviceHost({ DEVICE_HOST: 'ci' }).name).toBe('ci');
});

test('the ci host finds the booted simulator and runs Maestro on it', async () => {
  const { run, commands } = fakeRun({
    'xcrun simctl list': JSON.stringify({
      devices: {
        'com.apple.CoreSimulator.SimRuntime.iOS-18-2': [
          { udid: 'A1', name: 'iPhone 15', state: 'Shutdown' },
          { udid: 'B2', name: 'iPhone 16', state: 'Booted' },
        ],
      },
    }),
    maestro: 'Flow passed',
  });
  // The test names its own Java lookup, so it reads the same on a machine with no JDK in the path.
  const host = ciHost(run, { env: {}, javaRuns: () => Promise.resolve(true), exists: () => false });
  const device = { platform: 'ios' as const, id: 'B2', name: 'iPhone 16' };
  expect(await host.bootedDevice('ios')).toEqual(device);
  expect(await host.runFlow(device, 'features/a/journeys/sign-up.maestro.yaml')).toEqual({
    exitCode: 0,
    output: 'Flow passed',
  });
  expect(commands.at(-1)).toBe('maestro --device B2 test features/a/journeys/sign-up.maestro.yaml');
  expect(await host.checkFlow('features/a/journeys/sign-up.maestro.yaml')).toEqual({
    exitCode: 0,
    output: 'Flow passed',
  });
  expect(commands.at(-1)).toBe('maestro check-syntax features/a/journeys/sign-up.maestro.yaml');
});

test('the ci host finds the booted emulator by its AVD name, and none when nothing is booted', async () => {
  const booted = fakeRun({
    'adb devices': 'List of devices attached\nemulator-5554\tdevice\n',
    'adb -s emulator-5554 emu avd name': 'pixel-7-api-35\nOK\n',
  });
  expect(await ciHost(booted.run).bootedDevice('android')).toEqual({
    platform: 'android',
    id: 'emulator-5554',
    name: 'pixel-7-api-35',
  });
  const none = fakeRun({ 'adb devices': 'List of devices attached\n' });
  expect(await ciHost(none.run).bootedDevice('android')).toBeNull();
});

test('the ci host builds nothing', async () => {
  const { run } = fakeRun({});
  await expect(ciHost(run).build('apps/mobile', 'ios')).rejects.toBeInstanceOf(DeviceHostError);
});

const booted = JSON.stringify({
  devices: { runtime: [{ udid: 'B2', name: 'iPhone 16', state: 'Booted' }] },
});
const workspace = 'ios/Clutch.xcworkspace/contents.xcworkspacedata';
const built = 'ios/build/Build/Products/Debug-iphonesimulator/Clutch.app/Info.plist';

test('DEVICE_HOST=local gives the local host', () => {
  expect(deviceHost({ DEVICE_HOST: 'local' }).name).toBe('local');
});

test('the local host prebuilds, builds for any simulator, and installs on the booted device', async () => {
  const { run, commands } = fakeRun({
    'bun run': '',
    xcodebuild: '',
    'xcrun simctl list': booted,
    'xcrun simctl install': '',
  });
  const result = await inRepo({ [workspace]: '', [built]: '' }, async (root) => {
    const outcome = await localHost(run).build(root, 'ios');
    return { ...outcome, commands: commands.map((line) => line.replaceAll(root, 'APP')) };
  });
  expect(result.exitCode).toBe(0);
  expect(result.output).toContain('Installed the build on iPhone 16.');
  expect(result.commands).toEqual([
    'bun run --cwd APP prebuild:native --platform ios',
    'xcodebuild -workspace APP/ios/Clutch.xcworkspace -scheme Clutch -configuration Debug -sdk iphonesimulator -destination generic/platform=iOS Simulator -derivedDataPath APP/ios/build -quiet build',
    'xcrun simctl list devices booted --json',
    'xcrun simctl install B2 APP/ios/build/Build/Products/Debug-iphonesimulator/Clutch.app',
  ]);
});

test('the local host builds with no booted device, boots none, and names the install command', async () => {
  const { run, commands } = fakeRun({
    'bun run': '',
    xcodebuild: '',
    'xcrun simctl list': JSON.stringify({ devices: {} }),
  });
  const result = await inRepo({ [workspace]: '', [built]: '' }, (root) =>
    localHost(run).build(root, 'ios'),
  );
  expect(result.exitCode).toBe(0);
  expect(result.output).toContain('native:build --platform ios --install');
  expect(commands.some((line) => line.includes('simctl boot'))).toBe(false);
  expect(commands.some((line) => line.includes('simctl install'))).toBe(false);
});

test('the local host stops when a step fails, and when the prebuild wrote no project', async () => {
  const failing = fakeRun({ 'bun run': '' });
  const failed = await inRepo({ [workspace]: '' }, (root) =>
    localHost(failing.run).build(root, 'ios'),
  );
  expect(failed.exitCode).toBe(1);
  expect(failing.commands).toHaveLength(2);
  const missing = fakeRun({ 'bun run': '' });
  const none = await inRepo({ 'package.json': '{}' }, (root) =>
    localHost(missing.run).build(root, 'ios'),
  );
  expect(none.exitCode).toBe(1);
  expect(none.output).toContain('wrote no ios project');
});
