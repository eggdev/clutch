import { expect, test } from 'bun:test';

import { DeviceHostError, ciHost, deviceHost } from '@tools/native/device-host';
import type { Run } from '@tools/native/device-host';

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
  const host = ciHost(run);
  const device = { platform: 'ios' as const, id: 'B2', name: 'iPhone 16' };
  expect(await host.bootedDevice('ios')).toEqual(device);
  expect(await host.runFlow(device, 'features/a/journeys/sign-up.maestro.yaml')).toEqual({
    exitCode: 0,
    output: 'Flow passed',
  });
  expect(commands.at(-1)).toBe('maestro --device B2 test features/a/journeys/sign-up.maestro.yaml');
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
